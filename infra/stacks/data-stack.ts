import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { ThemisConfig } from '../config/env';

export interface DataStackProps extends cdk.StackProps {
  readonly config: ThemisConfig;
}

/**
 * System-of-record storage: DynamoDB tables for the operational domain objects
 * defined in packages/contracts, plus one S3 bucket for generated artifacts.
 *
 * Hackathon retention policy: every resource is RemovalPolicy.DESTROY (tables
 * dropped, bucket auto-emptied) so `cdk destroy` fully tears the demo down and
 * repeat deploys never collide with leftover state. Do not reuse this stack
 * as-is for anything holding real customer data.
 */
export class DataStack extends cdk.Stack {
  public readonly transactionsTable: dynamodb.Table;
  public readonly casesTable: dynamodb.Table;
  public readonly merchantsTable: dynamodb.Table;
  public readonly auditTable: dynamodb.Table;
  public readonly idempotencyTable: dynamodb.Table;
  public readonly artifactsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // transactionId is globally unique in the synthetic dataset (see
    // fixtures/transactions). Access patterns: fetch by id, list a customer's
    // transactions newest-first, list a merchant's transactions for profile
    // stats.
    this.transactionsTable = new dynamodb.Table(this, 'ThemisTransactions', {
      tableName: 'ThemisTransactions',
      partitionKey: { name: 'transactionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: 'byCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'occurredAt', type: dynamodb.AttributeType.STRING },
    });
    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: 'byMerchant',
      partitionKey: { name: 'merchantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'occurredAt', type: dynamodb.AttributeType.STRING },
    });

    // caseId is the primary key. Access patterns: fetch a case, list a
    // customer's cases, list open cases by status for the /review queue.
    this.casesTable = new dynamodb.Table(this, 'ThemisCases', {
      tableName: 'ThemisCases',
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.casesTable.addGlobalSecondaryIndex({
      indexName: 'byCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });
    this.casesTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    // merchantId is the primary key. MerchantProfile (risk signals, billing
    // patterns, case stats) is stored as a single item - no secondary access
    // pattern needed for the MVP dashboard (/merchants lists via a scan of
    // this small synthetic dataset, /merchants/[merchantId] is a get-item).
    this.merchantsTable = new dynamodb.Table(this, 'ThemisMerchants', {
      tableName: 'ThemisMerchants',
      partitionKey: { name: 'merchantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // One audit trail per case, chronological. eventId is prefixed with an
    // ISO timestamp by the writer so the sort key orders events correctly
    // (see AuditEventSchema in packages/contracts).
    this.auditTable = new dynamodb.Table(this, 'ThemisAudit', {
      tableName: 'ThemisAudit',
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Idempotency guard for retried inbound messages / tool calls (prompt.md
    // #31). Callers write with a ConditionExpression of
    // attribute_not_exists(idempotencyKey) before acting. TTL auto-expires
    // entries so the table never grows unbounded.
    this.idempotencyTable = new dynamodb.Table(this, 'ThemisIdempotency', {
      tableName: 'ThemisIdempotency',
      partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Single bucket, prefix-partitioned (reports/, evidence/, research/)
    // rather than three buckets - one IAM grant, one lifecycle policy, less
    // to provision and tear down for a hackathon-scale demo.
    this.artifactsBucket = new s3.Bucket(this, 'ThemisCaseArtifacts', {
      bucketName: undefined, // let CFN generate a unique name; avoids global-namespace collisions across redeploys
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { prefix: 'research/', expiration: cdk.Duration.days(30) },
      ],
    });

    new cdk.CfnOutput(this, 'TransactionsTableName', { value: this.transactionsTable.tableName });
    new cdk.CfnOutput(this, 'CasesTableName', { value: this.casesTable.tableName });
    new cdk.CfnOutput(this, 'MerchantsTableName', { value: this.merchantsTable.tableName });
    new cdk.CfnOutput(this, 'AuditTableName', { value: this.auditTable.tableName });
    new cdk.CfnOutput(this, 'IdempotencyTableName', { value: this.idempotencyTable.tableName });
    new cdk.CfnOutput(this, 'ArtifactsBucketName', { value: this.artifactsBucket.bucketName });
  }
}
