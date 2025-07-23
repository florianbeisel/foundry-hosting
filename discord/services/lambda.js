const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Invoke a Lambda function
 * @param {string} functionName - The name of the Lambda function
 * @param {Object} payload - The payload to send to the function
 * @returns {Promise<Object>} The response from the Lambda function
 */
async function invokeLambda(functionName, payload) {
  try {
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    });

    const response = await lambdaClient.send(command);
    const responsePayload = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    if (response.StatusCode !== 200) {
      throw new Error(`Lambda invocation failed with status ${response.StatusCode}`);
    }

    return responsePayload;
  } catch (error) {
    console.error(`Error invoking Lambda ${functionName}:`, error);
    throw error;
  }
}

/**
 * Invoke the Foundry Lambda function
 * @param {Object} payload - The payload to send to the function
 * @returns {Promise<Object>} The response from the Lambda function
 */
async function invokeFoundryLambda(payload) {
  const functionName = process.env.LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("LAMBDA_FUNCTION_NAME environment variable is not set");
  }
  return invokeLambda(functionName, payload);
}

module.exports = {
  invokeLambda,
  invokeFoundryLambda,
  lambdaClient,
};