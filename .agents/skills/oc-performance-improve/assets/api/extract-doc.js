// usage: GRAPHQL_PKG=<frontend>/node_modules/graphql node extract-doc.js <frontend>/lib/graphql/types/v2/graphql.ts <DocumentName>
// Prints the GraphQL document the frontend really sends (e.g. TransactionsTableDocument).
const fs = require('fs');
const { print } = require(process.env.GRAPHQL_PKG);
const src = fs.readFileSync(process.argv[2], 'utf8');
const marker = `export const ${process.argv[3]} = `;
const start = src.indexOf(marker) + marker.length;
const end = src.indexOf(' as unknown as DocumentNode', start);
console.log(print(JSON.parse(src.slice(start, end))));
