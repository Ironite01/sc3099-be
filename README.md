### Adjust the enviornment variables
Please edit docker-compose.yml according to your needs.
Set REDIS_LIMIT_HIGH=false to enable Redis limiting

### Build the Dockerfile
docker build -t sc3099-backend .

### Run the docker file with the following enviornment variables (adjust them accordingly)
docker-compose up