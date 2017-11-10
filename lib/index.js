'use strict';

const Writable = require('stream').Writable;
const EventEmitter = require('eventemitter3');

const Regex = {
    Value: /^(?:[\"\{\[\]\-\d]|true\b|false\b|null\b|\s{1,256})/,
    ValueIncomplete: /^(t$|tr$|tru$|f$|fa$|fal$|fals$|n$|nu$|null$|$)/,
    String: /^(?:[^\"\\]{1,256}|\\[bfnrt\"\\\/]|\\u[\da-fA-F]{4}|\")/,
    Key: /^(?:[\"\}]|\s{1,256})/,
    Colon: /^(?:\:|\s{1,256})/,
    Comma: /^(?:[\,\]\}]|\s{1,256})/,
    WS: /^\s{1,256}/,
    NumberStart: /^\d/,
    NumberDigit: /^\d{0,256}/,
    NumberFraction: /^[\.eE]/,
    NumberFracStart: this.NumberStart,
    NumberFracDigit: this.NumberDigit,
    NumberExponent: /^[eE]/,
    NumberExpSign: /^[-+]/,
    NumberExpStart: this.NumberStart,
    NumberExpDigit: this.NumberDigit
}

const Type = {
    Value1: 'value1',
    Value: 'value',
    Object: 'object',
    ObjectStop: 'objectStop',
    Array: 'array',
    ArrayStop: 'arrayStop',
    KeyValue: 'keyValue',
    Key: 'key',
    Key1: 'key1',
    Colon: 'colon',
    NumberStart: 'numberStart',
    NumberFraction: 'numberFraction',
    NumberDigit: 'numberDigit',
    NumberFracStart: 'numberFracStart',
    NumberFracDigit: 'numberFracDigit',
    NumberExpStart: 'numberExpSign',
    NumberExponent: 'numberExponent',
    NumberExpSign: 'numberExpSign',
    NumberExpDigit: 'numberExpDigit',
    Done: 'done'
}

const Events = {
    JSON: 'json',
    Error: 'error'
}

class JsonStreamParser extends Writable {
    constructor() {
        super();

        this._buffer = "";
        this._value = "";
        this._timeout = 1000;
        this._lastPacket;
        this._curIndex = 0;
        this._numBrackets = 0;
        this._expect = Type.Value;
        this._emitter = new EventEmitter();
        this._stack = [];
        this._jsonStreaming = true;
    }

    on(event, cb) {
        switch (event) {
            case Events.JSON:
                this._emitter.on(Events.JSON, cb);
                break;
            case Events.Error:
                this._emitter.on(Events.Error, cb);
                break;
        }
    }

    _parse(str) {
        let obj;
        try {
            obj = JSON.parse(str);
        } catch(error) {
            console.error('Invalid JSON after validating...');
            console.error(str);
            return;
        }

        this._emitter.emit(Events.JSON, obj);
    }

    _process(done) {
        var match, value;
        main: for (; ;) {
            switch (this._expect) {
                case Type.Value1:
                case Type.Value:
                    match = Regex.Value.exec(this._buffer);
                    if (!match) {
                        if(Regex.ValueIncomplete.exec(this._buffer)) break main;
                        else {
                            this._emitter.emit(Events.Error, 'Value expected');
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                    }
                    value = match[0];
                    switch (value) {
                        case "\"":
                            this._expect = Type.String;
                            break;
                        case "{":
                            this._stack.push(this._parent);
                            this._parent = Type.Object;
                            this._expect = Type.Key1;
                            break;
                        case "[":
                            this._stack.push(this._parent);
                            this._parent = Type.Array;
                            this._expect = Type.Value1;
                            break;
                        case "]":
                            if (this._expect !== Type.Value1) {
                                this._emitter.emit(Events.Error, "Parser cannot parse input: unexpected token ']'");
                                this._value = "";
                                this._buffer = this._buffer.slice(1);
                                break;
                            }
                            this._parent = this._stack.pop();
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        case "-":
                            this._expect = Type.NumberStart;
                            break;
                        case "0":
                            this._expect = Type.NumberFraction;
                            break;
                        case "1":
                        case "2":
                        case "3":
                        case "4":
                        case "5":
                        case "6":
                        case "7":
                        case "8":
                        case "9":
                            this._expect = Type.NumberDigit;
                            break;
                        case "true":
                        case "false":
                        case "null":
                            if (this._buffer.length === value.length && !this._done) {
                                // wait for more input
                                break main;
                            }
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        // default: // ws
                    }
                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.KeyValue:
                case Type.String:
                    match = Regex.String.exec(this._buffer);
                    if (!match) {
                        if (this._buffer) {
                            if (this._done || this._buffer.length >= 6) {
                                this._emitter.emit(Events.Error, "Parser cannot parse input: escaped characters");
                                this._value = "";
                                this._buffer = this._buffer.slice(1);
                                break;
                            }
                        }
                        if (this._done) {
                            this._emitter.emit(Events.Error, "Parser has expected a string value");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    if (value === "\"") {
                        if (this._expect === Type.KeyValue) {
                            this._expect = Type.Colon;
                        } else {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                        }
                    }

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.Key1:
                case Type.Key:
                    match = Regex.Key.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected an object key");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    if (value === "\"") {
                        this._expect = Type.KeyValue;
                    } else if (value === "}") {
                        if (this._expect !== Type.Key1) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: unexpected token '}'");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        this._parent = this._stack.pop();
                        if (this._parent) {
                            this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                        } else {
                            this._expect = Type.Done;
                        }
                    }

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.Colon:
                    match = Regex.Colon.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected ':'");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    if (value === ":") {
                        this._expect = Type.Value;
                    }

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.ArrayStop:
                case Type.ObjectStop:
                    match = Regex.Comma.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected ','");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    if (value === ",") {
                        this._expect = this._expect === Type.ArrayStop ? Type.Value : Type.Key;
                    } else if (value === "}" || value === "]") {
                        this._parent = this._stack.pop();
                        if (this._parent) {
                            this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                        } else {
                            this._expect = Type.Done;
                        }
                    }

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                // number chunks
                case Type.NumberStart: // [0-9]
                    match = Regex.NumberStart.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected a digit");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];

                    if (value === "0") this._expect = Type.NumberFraction;
                    else this._expect = Type.NumberDigit;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberDigit: // [0-9]*
                    match = Regex.NumberDigit.exec(this._buffer);
                    value = match[0];
                    if (value) {
                        this._value += value;
                        this._buffer = this._buffer.substring(value.length);
                    } else {
                        if (this._buffer) {
                            this._expect = Type.NumberFraction;
                            break;
                        }
                        if (this._done) {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    break;
                case Type.NumberFraction: // [\.eE]?
                    match = Regex.NumberFraction.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];

                    if (value === ".") this._expect = Type.NumberFracStart;
                    else this._expect = Type.NumberExpStart;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberFracStart: // [0-9]
                    match = Regex.NumberFracStart.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected a fractional part of a number");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    this._expect = Type.NumberFracDigit;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberFracDigit: // [0-9]*
                    match = Regex.NumberFracDigit.exec(this._buffer);
                    value = match[0];
                    if (value) {
                        this._value += value;
                        this._buffer = this._buffer.substring(value.length);
                    } else {
                        if (this._buffer) {
                            this._expect = Type.NumberExponent;
                            break;
                        }
                        if (this._done) {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    break;
                case Type.NumberExponent: // [eE]?
                    match = Regex.NumberExponent.exec(this._buffer);
                    if (!match) {
                        if (this._buffer) {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        }
                        if (this._done) {
                            this._expect = Type.Done;
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    this._expect = Type.NumberExpSign;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberExpSign: // [-+]?
                    match = Regex.NumberExpSign.exec(this._buffer);
                    if (!match) {
                        if (this._buffer) {
                            this._expect = Type.NumberExpStart;
                            break;
                        }
                        if (this._done) {
                            this._emitter.emit(Events.Error, "Parser has expected an exponent value of a number");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    this._expect = Type.NumberExpStart;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberExpStart: // [0-9]
                    match = Type.NumberExpStart.exec(this._buffer);
                    if (!match) {
                        if (this._buffer || this._done) {
                            this._emitter.emit(Events.Error, "Parser cannot parse input: expected an exponent part of a number");
                            this._value = "";
                            this._buffer = this._buffer.slice(1);
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    value = match[0];
                    this._expect = Type.NumberExpDigit;

                    this._value += value;
                    this._buffer = this._buffer.substring(value.length);
                    break;
                case Type.NumberExpDigit: // [0-9]*
                    match = Regex.NumberExpDigit.exec(this._buffer);
                    value = match[0];
                    if (value) {
                        this._value += value;
                        this._buffer = this._buffer.substring(value.length);
                    } else {
                        if (this._buffer || this._done) {
                            if (this._parent) {
                                this._expect = this._parent === Type.Object ? Type.ObjectStop : Type.ArrayStop;
                            } else {
                                this._expect = Type.Done;
                            }
                            break;
                        }
                        // wait for more input
                        break main;
                    }
                    break;
                case Type.Done:
                    match = Regex.WS.exec(this._buffer);
                    if (!match) {
                        if (this._buffer) {
                            if (this._jsonStreaming) {
                                this._expect = Type.Value;
                                this._parse(this._value);
                                this._value = '';
                                break;
                            }

                            return done(new Error("Parser cannot parse input: unexpected characters"));
                        }

                        this._parse(this._value);
                        this._value = '';
                        // wait for more input
                        break main;
                    }

                    this._buffer = this._buffer.substring(match[0].length);
                    break;
            }
        }
        done();
    }

    ///////////////////////
    // Transform Methods //
    ///////////////////////

    _write(chunk, encoding, cb) {
        this._buffer += chunk.toString();
        this._process(cb);
    }

    ///////////////////////////
    // End Transform Methods //
    ///////////////////////////
}

module.exports = JsonStreamParser