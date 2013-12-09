'use strict';

var StubRepository = require('./stubRepository'),
    utils = require('util'),
    Q = require('q');

function create (allowInjection) {

    var dryRunProxy = {
            to: function () { return Q({}); }
        };

    function dryRun (stub) {
        var testRequest = { path: '/', query: {}, method: 'GET', headers: {}, body: '' },
            stubRepository = StubRepository.create(dryRunProxy),
            clone = JSON.parse(JSON.stringify(stub)); // proxyOnce changes state

        stubRepository.addStub(clone);
        return stubRepository.resolve(testRequest);
    }

    function addDryRunErrors (stub, errors) {
        var deferred = Q.defer();

        try {
            dryRun(stub).done(deferred.resolve, function (reason) {
                reason.source = reason.source || JSON.stringify(stub);
                errors.push(reason);
                deferred.resolve();
            });
        }
        catch (error) {
            // Avoid digit methods, which probably represent incorrectly using an array, e.g.
            // Object #<Object> has no method '0'
            var invalidPredicate = /has no method '([A-Za-z_]+)'/.exec(error.message),
                message = 'malformed stub request';

            if (invalidPredicate) {
                message = "no predicate '" + invalidPredicate[1] + "'";
            }

            errors.push({
                code: 'bad data',
                message: message,
                data: error.message,
                source: JSON.stringify(stub)
            });
            deferred.resolve();
        }

        return deferred.promise;
    }

    function hasInjection (stub) {
        var hasResponseInjections = utils.isArray(stub.responses) && stub.responses.some(function (response) {
                return response.inject;
            }),
            hasPredicateInjections = Object.keys(stub.predicates || {}).some(function (predicate) {
                return stub.predicates[predicate].inject;
            });
        return hasResponseInjections || hasPredicateInjections;
    }

    function addInjectionErrors (stub, errors) {
        if (!allowInjection && hasInjection(stub)) {
            errors.push({
                code: 'invalid operation',
                message: 'inject is not allowed unless mb is run with the --allowInjection flag',
                source: JSON.stringify(stub)
            });
        }
    }

    function errorsFor (stub) {
        var errors = [],
            deferred = Q.defer();

        if (!utils.isArray(stub.responses) || stub.responses.length === 0) {
            errors.push({
                code: 'bad data',
                message: "'responses' must be a non-empty array",
                source: JSON.stringify(stub)
            });
        }
        addInjectionErrors(stub, errors);

        if (errors.length > 0) {
            // no sense in dry-running if there are already problems;
            // it will just add noise to the errors
            deferred.resolve(errors);
        }
        else {
            addDryRunErrors(stub, errors).done(function () {
                deferred.resolve(errors);
            });
        }

        return deferred.promise;
    }

    function validate (request) {
        var stubs = request.stubs || [],
            validationPromises = stubs.map(function (stub) { return errorsFor(stub); }),
            deferred = Q.defer();

        Q.all(validationPromises).done(function (errorsForAllStubs) {
            var allErrors = errorsForAllStubs.reduce(function (stubErrors, accumulator) {
                return accumulator.concat(stubErrors);
            }, []);
            deferred.resolve({ isValid: allErrors.length === 0, errors: allErrors });
        });

        return deferred.promise;
    }

    return {
        validate: validate
    };
}

module.exports = {
    create: create
};