### Env
HOST=localhost
PORT=8000
FRONTEND_URL=http://localhost:3000
DASHBOARD_URL=http://localhost:8501
ML_URL=http://localhost:8001

NODE_ENV=development

DATABASE_URL=postgres://postgres:password@127.0.0.1/capstone

REDIS_URL=redis://localhost:6379

# Set this to false to enable Redis limiting
REDIS_LIMIT_HIGH=true

SECRET_KEY=somesecret

###
To setup prisma
1. Install first
2. npx prisma generate