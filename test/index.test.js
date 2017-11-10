'use strict'

const expect = require('chai').expect;

const Parser = require('../lib/index');

describe('Testing JSON parser', function() {
    it('Parses full JSON strings', function(done) {
        let parser = new Parser();

        parser.on('json', (obj) => {
            console.log('GOT JSON!');
            console.log(obj);
        })

        //parser._buffer = '{"type":"READ","transactionID":"asf","element":"blah"}asdf{}';
        parser._buffer = '{}asdf{}';

        parser._process((err) => {
            done(err);
        });
    });
});