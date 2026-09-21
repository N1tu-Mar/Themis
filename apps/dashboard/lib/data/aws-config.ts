export interface AwsConfig {
  readonly casesTable: string;
  readonly merchantsTable: string;
  readonly auditTable: string;
  readonly artifactsBucket: string;
}

/** Reads the same names the Amplify app already receives from infra/stacks/web-stack.ts. */
export function awsConfigFromEnv(env: Record<string, string | undefined>): AwsConfig {
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`THEMIS_DASHBOARD_DATA_SOURCE=aws requires ${name}`);
    return value;
  };
  return {
    casesTable: need('CASES_TABLE'), merchantsTable: need('MERCHANTS_TABLE'),
    auditTable: need('AUDIT_TABLE'), artifactsBucket: need('ARTIFACTS_BUCKET'),
  };
}
