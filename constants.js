const { StatusCodes } = require('http-status-codes');
const { isString } = require('lodash');
const { RESPONSE_CODES } = require('../const/common-const.js');
class ResponseService {
    getParsedBodyFromEvent = (body) => {
        try {
            return typeof body === 'string' ? JSON.parse(body) : body;
        } catch (e) {
            logger.error('[COMMON][ERROR][getParsedBodyFromEvent]', e);
            throw handleError('INVALID_PARAMETER_VALUE', `Unable to Parse JSON Body [${JSON.stringify(body)}]`);
        }
    };
    constructor(event, context, isEcs = false) {
        isEcs = isString(isEcs) ? isEcs.toLowerCase() === 'true' : isEcs;
        let queryStringParameters, pathParameters, body;
        const { headers } = event || {};
        const { functionName = '' } = context || {};

        this.isEcs = isEcs;

        if (isEcs) {
            body = event.body;
            queryStringParameters = event.query || {};
            pathParameters = event.params || {};
            this.res = context;

            this.requestedTime = headers && headers.requestedtime
                ? headers.requestedtime
                : Date.now();
            this.requestedId = headers && headers.requestedid
                ? headers.requestedid
                : '';
            this.start = Date.now();
            this.coldStart = true;
            this.queryStringParameters = queryStringParameters;
            this.pathParameters = pathParameters;
            this.body = body;

            this.headers = {
                'Content-Type': (event && event.headers && event.headers['content-type']) || 'application/json',
                'X-Frame-Options': 'SAMEORIGIN',
                'functionName': functionName,
                'start': this.start,
                'requestedTime': this.requestedTime,
                'requestedId': this.requestedId,
            };
            // when requested from ecs, does not use singleton

            this.cookie = (event && event.headers && event.headers['Cookie']) || '';
            return this;
        } else {
            try {
                body = event.body ? getParsedBodyFromEvent(event.body) : '';
            } catch (e) {
                console.log('Error parsing body' + e.message)
                body = '';
            }
            queryStringParameters = event.queryStringParameters;
            pathParameters = event.pathParameters;
            this.cookie = (event && event.headers && event.headers['Cookie']) || '';
        }

        if (!ResponseService.instance) {
            this.functionName = functionName;
            this.requestedTime = headers && headers.requestedtime
                ? headers.requestedtime
                : Date.now();
            this.requestedId = headers && headers.requestedid
                ? headers.requestedid
                : '';
            this.start = Date.now();
            this.coldStart = true;
            this.queryStringParameters = queryStringParameters;
            this.pathParameters = pathParameters;
            this.body = body;

            this.headers = {
                'Content-Type': (event && event.headers && event.headers['content-type']) || 'application/json',
                'X-Frame-Options': 'SAMEORIGIN',
                'functionName': functionName,
                'start': this.start,
                'requestedTime': this.requestedTime,
                'requestedId': this.requestedId,
                'coldStart': this.coldStart,
            };

            ResponseService.instance = this;
            return ResponseService.instance;
        }

        ResponseService.instance.requestedId = headers && headers.requestedid
            ? headers.requestedid
            : '';
        ResponseService.instance.requestedTime = headers && headers.requestedtime
            ? headers.requestedtime
            : Date.now();
        ResponseService.instance.start = Date.now();
        ResponseService.instance.coldStart = false;
        ResponseService.instance.headers['Content-Type'] = (event && event.headers && event.headers['content-type']) || 'application/json';
        ResponseService.instance.headers.requestedId = ResponseService.instance.requestedId;
        ResponseService.instance.headers.requestedTime = ResponseService.instance.requestedTime;
        ResponseService.instance.headers.start = ResponseService.instance.start;
        ResponseService.instance.headers.coldStart = ResponseService.instance.coldStart;

        ResponseService.instance.queryStringParameters = queryStringParameters;
        ResponseService.instance.pathParameters = pathParameters;
        ResponseService.instance.body = body;

        return ResponseService.instance;
    }

    addCustomResponse = (code, params, responseBody = {}) => {
        if (code) {
            // if (Object.keys(responseBody).length === 0) {
            responseBody['resultMessage'] = code.MESSAGE
                + (params && params.message ? ` (${params.message})` : '');
            responseBody['resultCode'] = code.CODE;
        } else {
            responseBody['resultMessage'] = RESPONSE_CODES.UNKNOWN.MESSAGE
                + (params && params.type ? ` [${params.type}]` : '')
                + (params && params.message ? ` (${params.message})` : '');
            responseBody['resultCode'] = RESPONSE_CODES.UNKNOWN.CODE;
        }
        return responseBody;
    };

    createSetCookieResponse = (statusCode, headers = {}, cookies) => {
        if (this.isEcs) {
            cookies.forEach(({ name, value, option }) => {
                this.res.setHeader(name, value, option);
            });
            this.res.status(statusCode).end();
        } else {
            return {
                statusCode: statusCode,
                cookies: cookies,
                headers: {
                    ...headers,
                },
            };
        }
    };

    createResponseWithCookies = (statusCode, responseBody, headers = {}, cookies) => {
        if (this.isEcs) {
            const updatedHeaders = {
                ...this.headers,
                ...headers,
                end: Date.now(),
                ecs: true,
            };
            const keys = Object.keys(updatedHeaders);
            keys.forEach((key) => {
                this.res.setHeader(key, updatedHeaders[key]);
            });
            this.res.setHeader('Set-Cookie', cookies);
            this.res.write(JSON.stringify(responseBody));
            this.res.status(statusCode).end();
        } else {
            ResponseService.instance.headers.end = Date.now();
            return {
                statusCode: statusCode,
                cookies: cookies,
                headers: {
                    ...ResponseService.instance.headers,
                    ...headers,
                },
                body: JSON.stringify(responseBody),
            };
        }
    };

    createResponse = (
        statusCode, responseBody, headers = {}, isBase64Encoded) => {
        const needStringify = typeof responseBody == 'object';

        if (this.isEcs) {
            const updatedHeaders = {
                ...this.headers,
                ...headers,
                end: Date.now(),
                ecs: true,
            };
            const keys = Object.keys(updatedHeaders);
            keys.forEach((key) => {
                this.res.setHeader(key, updatedHeaders[key]);
            });
            this.res.status(statusCode).send(needStringify ? JSON.stringify(responseBody) : responseBody);
        } else {
            ResponseService.instance.headers.end = Date.now();
            return {
                statusCode: statusCode,
                headers: {
                    ...ResponseService.instance.headers,
                    ...headers,
                },
                body: needStringify ? JSON.stringify(responseBody) : responseBody,
                isBase64Encoded: isBase64Encoded ? true : false,
            };
        }
    };

    createNoContentHttpResponse = (responseBody) => {
        return this.createResponse(StatusCodes.NO_CONTENT, responseBody);
    };

    createAcceptedHttpResponse = (responseBody) => {
        return this.createResponse(StatusCodes.ACCEPTED, responseBody);
    };

    createOKHttpResponse = (responseBody) => {
        responseBody = this.addCustomResponse(RESPONSE_CODES.OK, {}, responseBody);
        return this.createResponse(StatusCodes.OK, responseBody);
    };

    createCreatedHttpResponse = (objectId, apiPath) => {
        if (this.isEcs) {
            if (objectId !== undefined && apiPath !== undefined) {
                return this.createResponse(StatusCodes.CREATED, {
                    id: objectId,
                    href: apiPath,
                });
            }
            this.res.status(StatusCodes.CREATED).end();
        } else {
            return this.createResponse(StatusCodes.CREATED, {
                id: objectId,
                href: apiPath,
            });
        }
    };

    createErrorHttpResponse = (statusCode, errorObject, body) => {
        logger.error(`[${statusCode}] ${errorObject}`);
        let responseBody = this.addCustomResponse(RESPONSE_CODES[errorObject.name], errorObject, body);
        return this.createResponse(statusCode, responseBody);
    };

    handleError = (errorType, errorMessage) => {
        const error = new Error(errorMessage);
        error.name = errorType;
        return error;
    };

    addHeader = (key, value) => {
        this.headers[key] = value;
    };

    appendHeader = (key, value) => {
        if (this.headers[key]) {
            this.headers[key] = this.headers[key] + ';' + value;
        } else {
            this.headers[key] = value;
        }
    };
}

module.exports = ResponseService;
