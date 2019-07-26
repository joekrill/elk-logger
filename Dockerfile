# BUILD-USING: docker build -t joekrill/elk-logger .
# RUN-USING:
# docker run \
#  --name=elk-logger \
#  -e PUID=1001 \
#  -e PGID=1001 \
#  -e ELK_USERNAME=<yourusername> \
#  -e ELK_PASSWORD=<yourpass> \
#  -e ELK_HOST=<yourdbpass> \
#  -e ELK_SECURE=1 \
#  -e DB_URL=postgresql:// \
#  -v <path to data>:/config \
#  joekrill/elk-logger

# specify base docker image
FROM node:10

# copy over dependencies
WORKDIR /usr/src/app

COPY . .

RUN yarn && yarn build

# /data can be mounted to get DB on host file system
VOLUME /data
ENV DB_URL=sqlite3:///data/elk-logger.db

CMD [ "npm", "start" ]