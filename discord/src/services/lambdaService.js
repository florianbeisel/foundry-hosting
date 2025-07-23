const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

// Initialize AWS Lambda client
const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-1",
});

async function invokeLambda(payload) {
  console.log(
    "Invoking Lambda with payload:",
    JSON.stringify(payload, null, 2)
  );

  const command = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_NAME,
    Payload: JSON.stringify(payload),
    InvocationType: "RequestResponse",
  });

  try {
    const response = await lambda.send(command);

    if (response.FunctionError) {
      throw new Error(`Lambda function error: ${response.FunctionError}`);
    }

    const result = JSON.parse(new TextDecoder().decode(response.Payload));

    if (result.statusCode !== 200) {
      const errorBody =
        typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      throw new Error(errorBody.error || "Unknown Lambda error");
    }

    return typeof result.body === "string"
      ? JSON.parse(result.body)
      : result.body;
  } catch (error) {
    console.error("Lambda invocation error:", error);
    throw error;
  }
}

module.exports = {
  invokeLambda,
};