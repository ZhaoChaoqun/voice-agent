FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BIND_HOST=0.0.0.0 PORT=8080
WORKDIR /app/samples/banking_ava
COPY samples/banking_ava/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home ava
COPY samples/foundry_voice_webrtc/auth.py /app/samples/foundry_voice_webrtc/auth.py
COPY samples/banking_ava/server.py samples/banking_ava/banking.py ./
COPY samples/banking_ava/public ./public
USER ava
EXPOSE 8080
CMD ["python", "server.py"]
