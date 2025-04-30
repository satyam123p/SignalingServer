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












Hello please convert the following code into python:---->const { StatusCodes } = require('http-status-codes');
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




Converted python code is --->
import json
import logging
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from threading import Lock

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

# Define response codes
class ResponseCodes:
    OK = {"CODE": "OK", "MESSAGE": "Success"}
    UNKNOWN = {"CODE": "UNKNOWN", "MESSAGE": "Unknown error"}
    INVALID_PARAMETER_VALUE = {"CODE": "INVALID_PARAMETER_VALUE", "MESSAGE": "Invalid parameter value"}
    # Add other codes from common-const.js as needed

RESPONSE_CODES = ResponseCodes()

class ResponseService:
    _instance = None
    _lock = Lock()

    def __init__(self, event: Optional[Dict] = None, context: Any = None, is_ecs: Union[str, bool] = False):
        self.logger = logging.getLogger(__name__)

        # Validate is_ecs
        if isinstance(is_ecs, str):
            is_ecs = is_ecs.lower() == 'true'
        elif not isinstance(is_ecs, bool):
            self.logger.warning(f"Invalid is_ecs type: {type(is_ecs)}. Defaulting to False.")
            is_ecs = False
        self.is_ecs = is_ecs

        event = event or {}
        context = context or type('Context', (), {'functionName': ''})()
        headers = event.get('headers', {})

        # Initialize common attributes
        self.function_name = getattr(context, 'functionName', '')
        if not self.function_name and not is_ecs:
            self.logger.warning("Context object missing functionName attribute")
        self.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        self.requested_id = headers.get('requestedid', '')
        self.start = int(datetime.now().timestamp() * 1000)
        self.cold_start = True
        self.cookie = headers.get('Cookie', '')

        if is_ecs:
            self._initialize_ecs(event, context, headers)
        else:
            self._initialize_non_ecs(event, headers)

        # Singleton pattern for non-ECS
        if not is_ecs:
            with self._lock:
                if not ResponseService._instance:
                    ResponseService._instance = self
                else:
                    self._update_instance(event, headers)
                return ResponseService._instance

    def _initialize_ecs(self, event: Dict, context: Any, headers: Dict):
        self.res = context  # Framework-specific response object (e.g., Flask Response)
        self.body = event.get('body', '')
        self.query_string_parameters = event.get('query', {})
        self.path_parameters = event.get('params', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
        }

    def _initialize_non_ecs(self, event: Dict, headers: Dict):
        try:
            self.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''
        except Exception as e:
            self.logger.error(f"Error parsing body: {str(e)}")
            self.body = ''
        
        self.query_string_parameters = event.get('queryStringParameters', {})
        self.path_parameters = event.get('pathParameters', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
            'coldStart': self.cold_start,
        }

    def _update_instance(self, event: Dict, headers: Dict):
        instance = ResponseService._instance
        instance.requested_id = headers.get('requestedid', '')
        instance.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        instance.start = int(datetime.now().timestamp() * 1000)
        instance.cold_start = False
        instance.headers.update({
            'Content-Type': headers.get('content-type', 'application/json'),
            'requestedId': instance.requested_id,
            'requestedTime': instance.requested_time,
            'start': instance.start,
            'coldStart': instance.cold_start,
        })
        instance.query_string_parameters = event.get('queryStringParameters', {})
        instance.path_parameters = event.get('pathParameters', {})
        instance.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''

    def _get_parsed_body_from_event(self, body: Union[str, Dict]) -> Any:
        try:
            if isinstance(body, str):
                if not body.strip():
                    return {}
                return json.loads(body)
            return body
        except json.JSONDecodeError as e:
            self.logger.error(f"[COMMON][ERROR][getParsedBodyFromEvent] {str(e)}")
            raise self._handle_error('INVALID_PARAMETER_VALUE', f"Unable to Parse JSON Body [{body}]")

    def add_custom_response(self, code: Optional[Dict], params: Dict, response_body: Optional[Dict] = None) -> Dict:
        response_body = response_body or {}
        if code:
            response_body['resultMessage'] = code['MESSAGE'] + (f" ({params['message']})" if params.get('message') else '')
            response_body['resultCode'] = code['CODE']
        else:
            message = RESPONSE_CODES.UNKNOWN['MESSAGE']
            if params.get('type'):
                message += f" [{params['type']}]"
            if params.get('message'):
                message += f" ({params['message']})"
            response_body['resultMessage'] = message
            response_body['resultCode'] = RESPONSE_CODES.UNKNOWN['CODE']
        return response_body

    def create_set_cookie_response(self, status_code: int, headers: Optional[Dict] = None, cookies: Optional[List[Dict]] = None) -> Union[None, Dict]:
        headers = headers or {}
        cookies = cookies or []
        if self.is_ecs:
            # Framework-specific: Adjust for Flask, FastAPI, etc.
            for cookie in cookies:
                # Example: self.res.set_header('Set-Cookie', f"{cookie['name']}={cookie['value']}; {cookie.get('option', {})}")
                self.res.set_header(cookie['name'], cookie['value'], cookie.get('option', {}))
            # Example for Flask: return self.res.status_code = status_code; return self.res
            self.res.status(status_code).end()  # Framework-specific
        else:
            return {
                'statusCode': status_code,
                'cookies': cookies,
                'headers': headers,
            }

    def create_response_with_cookies(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, cookies: Optional[List] = None) -> Union[None, Dict]:
        headers = headers or {}
        cookies = cookies or []
        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            # Framework-specific: Set headers
            for key, value in updated_headers.items():
                self.res.set_header(key, value)
            self.res.set_header('Set-Cookie', cookies)
            self.res.write(json.dumps(response_body) if isinstance(response_body, (dict, list)) else response_body)
            # Example for Flask: self.res.status_code = status_code; return self.res
            self.res.status(status_code).end()
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'cookies': cookies,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if isinstance(response_body, (dict, list)) else response_body,
            }

    def create_response(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, is_base64_encoded: bool = False) -> Union[None, Dict]:
        headers = headers or {}
        need_stringify = isinstance(response_body, (dict, list))
        
        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            # Framework-specific: Set headers and response
            for key, value in updated_headers.items():
                self.res.set_header(key, value)
            self.res.status(status_code).send(json.dumps(response_body) if need_stringify else response_body)
            # Example for Flask: return Response(response=..., status=status_code, headers=updated_headers)
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if need_stringify else response_body,
                'isBase64Encoded': is_base64_encoded,
            }

    def create_no_content_http_response(self, response_body: Any) -> Union[None, Dict]:
        return self.create_response(HTTPStatus.NO_CONTENT, response_body)

    def create_accepted_http_response(self, response_body: Any) -> Union[None, Dict]:
        return self.create_response(HTTPStatus.ACCEPTED, response_body)

    def create_ok_http_response(self, response_body: Any) -> Union[None, Dict]:
        response_body = self.add_custom_response(RESPONSE_CODES.OK, {}, response_body)
        return self.create_response(HTTPStatus.OK, response_body)

    def create_created_http_response(self, object_id: Any = None, api_path: Optional[str] = None) -> Union[None, Dict]:
        if self.is_ecs:
            if object_id is not None and api_path is not None:
                return self.create_response(HTTPStatus.CREATED, {'id': object_id, 'href': api_path})
            # Framework-specific: self.res.status_code = HTTPStatus.CREATED; return self.res
            self.res.status(HTTPStatus.CREATED).end()
        else:
            response = {'id': object_id, 'href': api_path} if object_id is not None and api_path is not None else {}
            return self.create_response(HTTPStatus.CREATED, response)

    def create_error_http_response(self, status_code: int, error_object: Exception, body: Optional[Dict] = None) -> Union[None, Dict]:
        self.logger.error(f"[{status_code}] {str(error_object)}")
        response_body = self.add_custom_response(
            RESPONSE_CODES.get(getattr(error_object, 'name', 'UNKNOWN'), RESPONSE_CODES.UNKNOWN),
            {'type': getattr(error_object, 'name', 'UNKNOWN'), 'message': str(error_object)},
            body
        )
        return self.create_response(status_code, response_body)

    def _handle_error(self, error_type: str, error_message: str) -> Exception:
        error = Exception(error_message)
        error.name = error_type
        return error

    def add_header(self, key: str, value: Any):
        self.headers[key] = value

    def append_header(self, key: str, value: Any):
        if key in self.headers:
            self.headers[key] = f"{self.headers[key]};{value}"
        else:
            self.headers[key] = value










import json
import logging
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from threading import Lock

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

# Define response codes
class ResponseCodes:
    OK = {"CODE": "OK", "MESSAGE": "Success"}
    UNKNOWN = {"CODE": "UNKNOWN", "MESSAGE": "Unknown error"}
    INVALID_PARAMETER_VALUE = {"CODE": "INVALID_PARAMETER_VALUE", "MESSAGE": "Invalid parameter value"}

RESPONSE_CODES = ResponseCodes()

class ResponseService:
    _instance = None
    _lock = Lock()

    def __init__(self, event: Optional[Dict] = None, context: Any = None, is_ecs: Union[str, bool] = False):
        self.logger = logging.getLogger(__name__)

        if isinstance(is_ecs, str):
            is_ecs = is_ecs.lower() == 'true'
        elif not isinstance(is_ecs, bool):
            self.logger.warning(f"Invalid is_ecs type: {type(is_ecs)}. Defaulting to False.")
            is_ecs = False
        self.is_ecs = is_ecs

        event = event or {}
        context = context or type('Context', (), {'functionName': ''})()
        headers = {k.lower(): v for k, v in event.get('headers', {}).items()}

        self.function_name = getattr(context, 'functionName', '')
        if not self.function_name and not is_ecs:
            self.logger.warning("Context object missing functionName attribute")
        self.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        self.requested_id = headers.get('requestedid', '')
        self.start = int(datetime.now().timestamp() * 1000)
        self.cold_start = True
        self.cookie = headers.get('cookie', '')

        if is_ecs:
            self._initialize_ecs(event, context, headers)
        else:
            self._initialize_non_ecs(event, headers)

        if not is_ecs:
            with self._lock:
                if not ResponseService._instance:
                    ResponseService._instance = self
                else:
                    self._update_instance(event, headers)
                return

    def _initialize_ecs(self, event: Dict, context: Any, headers: Dict):
        self.res = context
        self.body = event.get('body', '')
        self.query_string_parameters = event.get('query', {})
        self.path_parameters = event.get('params', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
        }

    def _initialize_non_ecs(self, event: Dict, headers: Dict):
        try:
            self.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''
        except Exception as e:
            self.logger.error(f"Error parsing body: {str(e)}")
            self.body = ''

        self.query_string_parameters = event.get('queryStringParameters', {})
        self.path_parameters = event.get('pathParameters', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
            'coldStart': self.cold_start,
        }

    def _update_instance(self, event: Dict, headers: Dict):
        instance = ResponseService._instance
        instance.requested_id = headers.get('requestedid', '')
        instance.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        instance.start = int(datetime.now().timestamp() * 1000)
        instance.cold_start = False
        instance.headers.update({
            'Content-Type': headers.get('content-type', 'application/json'),
            'requestedId': instance.requested_id,
            'requestedTime': instance.requested_time,
            'start': instance.start,
            'coldStart': instance.cold_start,
        })
        instance.query_string_parameters = event.get('queryStringParameters', {})
        instance.path_parameters = event.get('pathParameters', {})
        instance.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''

    def _get_parsed_body_from_event(self, body: Union[str, Dict]) -> Any:
        try:
            if isinstance(body, str):
                if not body.strip():
                    return {}
                return json.loads(body)
            return body
        except json.JSONDecodeError as e:
            self.logger.error(f"[COMMON][ERROR][getParsedBodyFromEvent] {str(e)}")
            raise self._handle_error('INVALID_PARAMETER_VALUE', f"Unable to Parse JSON Body [{body}]")

    def add_custom_response(self, code: Optional[Dict], params: Dict, response_body: Optional[Dict] = None) -> Dict:
        response_body = response_body or {}
        if code:
            response_body['resultMessage'] = code['MESSAGE'] + (f" ({params['message']})" if params.get('message') else '')
            response_body['resultCode'] = code['CODE']
        else:
            message = RESPONSE_CODES.UNKNOWN['MESSAGE']
            if params.get('type'):
                message += f" [{params['type']}]"
            if params.get('message'):
                message += f" ({params['message']})"
            response_body['resultMessage'] = message
            response_body['resultCode'] = RESPONSE_CODES.UNKNOWN['CODE']
        return response_body

    def create_response(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, is_base64_encoded: bool = False) -> Union[None, Dict]:
        headers = headers or {}
        need_stringify = isinstance(response_body, (dict, list))

        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            for key, value in updated_headers.items():
                self.res.headers[key] = value
            self.res.status_code = status_code
            self.res.set_data(json.dumps(response_body) if need_stringify else response_body)
            return self.res
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if need_stringify else response_body,
                'isBase64Encoded': is_base64_encoded,
            }

    def create_ok_http_response(self, response_body: Any) -> Union[None, Dict]:
        response_body = self.add_custom_response(RESPONSE_CODES.OK, {}, response_body)
        return self.create_response(HTTPStatus.OK, response_body)

    def create_created_http_response(self, object_id: Any = None, api_path: Optional[str] = None) -> Union[None, Dict]:
        response = {'id': object_id, 'href': api_path} if object_id is not None and api_path is not None else {}
        return self.create_response(HTTPStatus.CREATED, response)

    def create_error_http_response(self, status_code: int, error_object: Exception, body: Optional[Dict] = None) -> Union[None, Dict]:
        self.logger.error(f"[{status_code}] {str(error_object)}")
        code_obj = getattr(RESPONSE_CODES, getattr(error_object, 'name', 'UNKNOWN'), RESPONSE_CODES.UNKNOWN)
        response_body = self.add_custom_response(
            code_obj,
            {'type': getattr(error_object, 'name', 'UNKNOWN'), 'message': str(error_object)},
            body
        )
        return self.create_response(status_code, response_body)

    def _handle_error(self, error_type: str, error_message: str) -> Exception:
        error = Exception(error_message)
        setattr(error, 'name', error_type)
        return error

    def add_header(self, key: str, value: Any):
        self.headers[key] = value

    def append_header(self, key: str, value: Any):
        if key in self.headers:
            self.headers[key] = f"{self.headers[key]};{value}"
        else:
            self.headers[key] = value


