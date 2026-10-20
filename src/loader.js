import protoLoader from '@grpc/proto-loader';
import grpc from '@grpc/grpc-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loads the .proto file and turns it into a JS object we can use.
// `keepCase` keeps field names as written (snake_case) instead of camelCasing them.
export const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, '..', 'proto', 'greeter.proto'),
  {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

// The actual service definition, ready to bind to a server or a client.
export const greeterPackage = grpc.loadPackageDefinition(packageDefinition).greeter;
