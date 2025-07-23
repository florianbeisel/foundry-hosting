/*
 * discord/src/aws/lambda.js
 * Thin wrapper around AWS Lambda SDK for invoking our backend.
 */

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { awsRegion, lambdaFunctionName } = require("../config");

// Re-use the same client across the entire process
const client = new LambdaClient({ region: awsRegion });

/**
 * Invoke the configured Lambda function with a JSON payload.
 * Resolves with the parsed JSON response body.
 * Throws if the invocation returns an error.
 *
 * @template TResponse
 * @param {Record<string, unknown>} payload
 * @returns {Promise<TResponse>}
 */
async function invoke(payload) {
  const command = new InvokeCommand({
    FunctionName: lambdaFunctionName,
    Payload: JSON.stringify(payload),
    InvocationType: "RequestResponse",
  });

  const res = await client.send(command);

  if (res.FunctionError) {
    throw new Error(`Lambda function error: ${res.FunctionError}`);
  }

  const decoded = JSON.parse(new TextDecoder().decode(res.Payload));

  if (decoded.statusCode !== 200) {
    const errBody = typeof decoded.body === "string" ? JSON.parse(decoded.body) : decoded.body;
    throw new Error(errBody.error || "Unknown Lambda error");
  }

  return typeof decoded.body === "string" ? JSON.parse(decoded.body) : decoded.body;
}

module.exports = { invoke };