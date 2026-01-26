# Client API

Cloudana backend API for templates.

## Endpoints

### API Endpoints

- `GET /health` - Health check
- `GET /v1/templates-list` - Get list of templates (id, name, category)
- `GET /v1/templates` - Get all templates with full details
- `GET /v1/templates/:id` - Get a specific template by ID

### Documentation Endpoints

- `GET /v1/swagger` - Swagger UI for interactive API documentation
- `GET /v1/doc` - OpenAPI JSON specification

## Development

### Using npm

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start
```

### Using yarn

```bash
# Install dependencies
yarn install

# Run in development mode
yarn dev

# Run in production mode
yarn start
```

## Environment Variables

- `PORT` - Server port (default: 3000)
