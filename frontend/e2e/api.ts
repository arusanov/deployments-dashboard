const configuredURL = process.env.TEST_API_URL;

if (!configuredURL) {
  throw new Error(
    "Set TEST_API_URL to the disposable API before running E2E tests.",
  );
}

export const apiURL = configuredURL;
