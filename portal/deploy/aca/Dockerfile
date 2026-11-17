# Copyright (c) Microsoft. All rights reserved.
# Voice Agent Portal for Azure Container Apps.
#
# Build context (git archive of a voice-agent checkout, uploaded by skills/portal-remote/scripts/build.sh to az acr build):
#   portal/   samples/   docs/        tracked files only, no .env, no node_modules
#   (portal/deploy/aca/ brings nginx.conf and supervise.py along)
#
# The portal itself is unchanged: it still listens on 127.0.0.1:9527 and keeps its
# loopback/same-origin guard. nginx on :8080 is the only listener the ingress reaches.
FROM python:3.12-alpine

RUN apk upgrade --no-cache && apk add --no-cache nginx

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHON_DOTENV_DISABLED=1 \
    DEMO_PORT=9527 \
    VOICE_PORTAL_HOST=127.0.0.1 \
    VOICE_PORTAL_DATA_DIR=/tmp/voice-agent-portal \
    VOICE_PORTAL_RECORD_SESSIONS=false \
    AZURE_CREDENTIAL_MODE=default

COPY portal/requirements.txt /app/portal/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/portal/requirements.txt \
    && python -m pip check \
    && adduser -D -u 10001 portal

COPY portal/ /app/portal/
COPY samples/ /app/samples/
COPY docs/ /app/docs/

USER 10001

# Fail the build, not the first browser visit, if the template catalog or proxy config is broken.
RUN cd /app/portal \
    && python -c "from template_portal import TemplateCatalog; c = TemplateCatalog(); assert not c.errors, c.errors; print(len(c.cards()), 'templates')" \
    && nginx -e /dev/stderr -t -c /app/portal/deploy/aca/nginx.conf

EXPOSE 8080
CMD ["python", "/app/portal/deploy/aca/supervise.py"]
