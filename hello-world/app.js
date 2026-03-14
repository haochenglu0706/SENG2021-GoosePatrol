"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lambdaHandler = void 0;
const aws_lambda_1 = require("aws-lambda");
/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
const lambdaHandler = async (event) => {
    try {
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'hello world',
            }),
        };
    }
    catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'some error happened',
            }),
        };
    }
};
exports.lambdaHandler = lambdaHandler;
//# sourceMappingURL=app.js.map