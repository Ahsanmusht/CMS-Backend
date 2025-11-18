const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Client Management System API',
      version: '1.0.0',
      description: 'Comprehensive API for managing clients, appointments, services, and more',
      contact: {
        name: 'API Support'
      }
    },
    servers: [
       {
        url: `${process.env.BASE_URL}`,
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js', './models/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  }));
};