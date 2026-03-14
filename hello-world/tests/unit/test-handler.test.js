"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_lambda_1 = require("aws-lambda");
const app_1 = require("../../app");
const globals_1 = require("@jest/globals");
(0, globals_1.describe)('Unit test for app handler', function () {
    (0, globals_1.it)('verifies successful response', async () => {
        const event = {
            httpMethod: 'get',
            body: '',
            headers: {},
            isBase64Encoded: false,
            multiValueHeaders: {},
            multiValueQueryStringParameters: {},
            path: '/hello',
            pathParameters: {},
            queryStringParameters: {},
            requestContext: {
                accountId: '123456789012',
                apiId: '1234',
                authorizer: {},
                httpMethod: 'get',
                identity: {
                    accessKey: '',
                    accountId: '',
                    apiKey: '',
                    apiKeyId: '',
                    caller: '',
                    clientCert: {
                        clientCertPem: '',
                        issuerDN: '',
                        serialNumber: '',
                        subjectDN: '',
                        validity: { notAfter: '', notBefore: '' },
                    },
                    cognitoAuthenticationProvider: '',
                    cognitoAuthenticationType: '',
                    cognitoIdentityId: '',
                    cognitoIdentityPoolId: '',
                    principalOrgId: '',
                    sourceIp: '',
                    user: '',
                    userAgent: '',
                    userArn: '',
                },
                path: '/hello',
                protocol: 'HTTP/1.1',
                requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef',
                requestTimeEpoch: 1428582896000,
                resourceId: '123456',
                resourcePath: '/hello',
                stage: 'dev',
            },
            resource: '',
            stageVariables: {},
        };
        const result = await (0, app_1.lambdaHandler)(event);
        (0, globals_1.expect)(result.statusCode).toEqual(200);
        (0, globals_1.expect)(result.body).toEqual(JSON.stringify({
            message: 'hello world',
        }));
    });
});
//# sourceMappingURL=test-handler.test.js.map