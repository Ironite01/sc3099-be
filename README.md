### Adjust the enviornment variables
Please edit docker-entrypoint.sh according to your needs.
Set REDIS_LIMIT_HIGH=false to enable Redis limiting

### Build the Dockerfile
docker build -t sc3099-backend .

### Run the docker file with the following enviornment variables (adjust them accordingly)
docker run -p 8000:8000 \
  -e HOST=0.0.0.0 \
  -e PORT=8000 \
  -e FRONTEND_URL=host.docker.internal:3000 \
  -e DASHBOARD_URL=http://host.docker.internal:8501 \
  -e ML_URL=http://host.docker.internal:8001 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/capstone \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e REDIS_LIMIT_HIGH=true \
  -e SECRET_KEY=your-secret-key \
  -e EMAIL_SMTP_HOST=smtp.gmail.com \
  -e EMAIL_SMTP_PORT=587 \
  -e EMAIL_SMTP_USER=kristiguin26556@gmail.com \
  -e EMAIL_SMTP_PASS=ebghyznnnnkcmcbh \
  -e EMAIL_FROM="SAIV <kristiguin26556@gmail.com>" \
  sc3099-backend