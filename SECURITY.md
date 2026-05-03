# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in mcp-graphql-bridge, please report it responsibly.

1. **Do not open a public issue** on GitHub
2. Email security concerns to: murilo@murilopereira.com
3. Include details about the vulnerability and steps to reproduce
4. Allow up to 48 hours for an initial response

## Security Considerations

When using mcp-graphql-bridge:

- **Never commit tokens**: Always use environment variables or secret management (AWS Secrets Manager, etc.)
- **Token scope**: Use GraphQL tokens with minimal required permissions
- **Network security**: Ensure `GRAPHQL_API_URL` uses HTTPS in production
- **Introspection**: Disable GraphQL introspection in production if not needed

## Known Limitations

- The server stores the bearer token in memory during execution
- No built-in token refresh mechanism — tokens are static per invocation
- Schema introspection results are cached in memory, not encrypted at rest