// Print a GraphQL operation exactly as the frontend sends it, from the frontend's generated types.
//
// usage: GRAPHQL_PKG=<repo>/node_modules/graphql node extract-operation.js \
//          <opencollective-frontend>/lib/graphql/types/v2/graphql.ts <OperationName>Document > op.graphql
//
// Find the document name with: grep -o 'export const [A-Za-z]*Document' graphql.ts | grep -i <keyword>
const fs = require('fs');
const { print } = require(process.env.GRAPHQL_PKG || 'graphql');

const [file, name] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const marker = `export const ${name} = `;
const start = source.indexOf(marker);
if (start === -1) {
  console.error(`${name} not found in ${file}`);
  process.exit(1);
}
const end = source.indexOf(' as unknown as DocumentNode', start);
console.log(print(JSON.parse(source.slice(start + marker.length, end))));
