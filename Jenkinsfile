pipeline {
  agent any

  environment {
    DOCKER_BUILDKIT = '1'

    VM_SSH_CRED_ID    = 'punjab-voiceai'
    GITHUB_CRED_ID    = 'github-cred'
    DOCKERHUB_CRED_ID = 'dockerhub-creds'

    BACKEND_IMAGE  = 'casdevops/punjab-voice-backend'
    FRONTEND_IMAGE = 'casdevops/punjab-voice-frontend'

    VM_USER    = 'cubeai'
    VM_HOST    = '192.168.1.55'
    VM_APP_DIR = '/home/cubeai/punjab-voice-app'

    GIT_BRANCH = 'deploy'
    GIT_URL    = 'https://github.com/cubeaisolutionstech/Punjab-voice-AI-Assistant-.git'

    BACKEND_DIR  = 'server'
    FRONTEND_DIR = '.'
    
    CLOUDFLARE_TUNNEL_CRED_ID = 'cloudflare-tunnel-token'
  }

  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
  }

  stages {
    stage('Verify VM SSH Connection') {
      steps {
        echo 'Testing SSH connection to VM...'
        withCredentials([sshUserPrivateKey(
          credentialsId: "${VM_SSH_CRED_ID}",
          keyFileVariable: 'SSH_KEY'
        )]) {
          sh '''
            ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i "$SSH_KEY" \
              ${VM_USER}@${VM_HOST} 'echo "SSH OK - $(hostname)"'
          '''
        }
      }
    }

    stage('Checkout Code') {
      steps {
        echo 'Fetching source code...'
        git branch: "${GIT_BRANCH}",
          url: "${GIT_URL}",
          credentialsId: "${GITHUB_CRED_ID}"
      }
    }

    stage('Build & Push Backend Image') {
      steps {
        echo 'Building backend Docker image...'
        dir("${BACKEND_DIR}") {
          sh "docker build --no-cache -t ${BACKEND_IMAGE}:latest ."
        }
        withCredentials([usernamePassword(
          credentialsId: "${DOCKERHUB_CRED_ID}",
          usernameVariable: 'DOCKERHUB_USER',
          passwordVariable: 'DOCKERHUB_PASSWORD'
        )]) {
          sh '''
            echo "$DOCKERHUB_PASSWORD" | docker login -u "$DOCKERHUB_USER" --password-stdin
            docker push ${BACKEND_IMAGE}:latest
          '''
        }
      }
    }

    stage('Build & Push Frontend Image') {
      steps {
        echo 'Building frontend Docker image...'
        dir("${FRONTEND_DIR}") {
          sh "docker build --no-cache -t ${FRONTEND_IMAGE}:latest -f Dockerfile ."
        }
        withCredentials([usernamePassword(
          credentialsId: "${DOCKERHUB_CRED_ID}",
          usernameVariable: 'DOCKERHUB_USER',
          passwordVariable: 'DOCKERHUB_PASSWORD'
        )]) {
          sh '''
            echo "$DOCKERHUB_PASSWORD" | docker login -u "$DOCKERHUB_USER" --password-stdin
            docker push ${FRONTEND_IMAGE}:latest
          '''
        }
      }
    }

    stage('Clean Up Remote Disk') {
      steps {
        echo 'Cleaning up remote VM disk space...'
        withCredentials([sshUserPrivateKey(
          credentialsId: "${VM_SSH_CRED_ID}",
          keyFileVariable: 'SSH_KEY'
        )]) {
          sh '''
            ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" \
              ${VM_USER}@${VM_HOST} bash -s <<'CLEANUP_EOF'
              set -e
              echo "Disk usage before cleanup:"
              df -h / | grep -v Filesystem || true
              
              # Clean up Docker system
              docker system prune -f -a --volumes 2>/dev/null || true
              
              # Remove old container logs
              find /var/lib/docker/containers -name "*-json.log*" -type f -delete 2>/dev/null || true
              
              # Remove old application cache if exists
              rm -rf /home/cubeai/.npm /home/cubeai/.cache 2>/dev/null || true
              
              echo "Disk usage after cleanup:"
              df -h / | grep -v Filesystem || true
CLEANUP_EOF
          '''
        }
      }
    }

    stage('Copy Config to VM') {
      steps {
        echo 'Copying project files to VM...'
        withCredentials([sshUserPrivateKey(
          credentialsId: "${VM_SSH_CRED_ID}",
          keyFileVariable: 'SSH_KEY'
        )]) {
          sh '''
            ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" \
              ${VM_USER}@${VM_HOST} "mkdir -p ${VM_APP_DIR}"

            rsync -avz --delete \
              -e "ssh -o StrictHostKeyChecking=no -i $SSH_KEY" \
              --exclude='.git' \
              --exclude='.env' \
              --exclude='node_modules' \
              --exclude='server/node_modules' \
              --exclude='*.log' \
              ./ ${VM_USER}@${VM_HOST}:${VM_APP_DIR}/
          '''
        }
      }
    }

    stage('Deploy to Proxmox VM') {
      steps {
        echo 'Deploying application on Proxmox VM...'
        withCredentials([
          sshUserPrivateKey(
            credentialsId: "${VM_SSH_CRED_ID}",
            keyFileVariable: 'SSH_KEY'
          ),
          usernamePassword(
            credentialsId: "${DOCKERHUB_CRED_ID}",
            usernameVariable: 'DOCKERHUB_USER',
            passwordVariable: 'DOCKERHUB_PASSWORD'
          ),
          string(
            credentialsId: "${CLOUDFLARE_TUNNEL_CRED_ID}",
            variable: 'CLOUDFLARE_TUNNEL_TOKEN'
          )
        ]) {
          sh '''
            ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" ${VM_USER}@${VM_HOST} "VM_APP_DIR='${VM_APP_DIR}' DOCKERHUB_USER='${DOCKERHUB_USER}' DOCKERHUB_PASSWORD='${DOCKERHUB_PASSWORD}' NGROK_URL='${NGROK_URL}' CLOUDFLARE_TUNNEL_TOKEN='${CLOUDFLARE_TUNNEL_TOKEN}' bash -s" <<'EOF'
              set -e
              mkdir -p "$VM_APP_DIR"
              cd "$VM_APP_DIR"

              if command -v sudo >/dev/null 2>&1; then
                sudo -n systemctl enable --now docker >/dev/null 2>&1 || true
              fi

              if ! docker info >/dev/null 2>&1; then
                echo 'Docker daemon is not available on the VM.'
                echo 'Start Docker service or grant cubeai access to the docker group, then rerun Jenkins.'
                exit 1
              fi

              COMPOSE_CMD='docker compose'
              if ! docker compose version >/dev/null 2>&1; then
                if command -v docker-compose >/dev/null 2>&1; then
                  COMPOSE_CMD='docker-compose'
                else
                  echo 'Neither docker compose nor docker-compose is available on the VM.'
                  echo 'Install the Docker Compose plugin or docker-compose and rerun Jenkins.'
                  exit 1
                fi
              fi

              echo "$DOCKERHUB_PASSWORD" | docker login -u "$DOCKERHUB_USER" --password-stdin

              # Prepare .env for backend
              if [ ! -f .env ]; then
                touch .env
              fi

              grep -v '^NGROK_URL=' .env | grep -v '^CLOUDFLARE_TUNNEL_TOKEN=' 2>/dev/null > .env.tmp || true
              mv .env.tmp .env

              printf '%s\n' "NGROK_URL=$NGROK_URL" >> .env
              if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
                printf '%s\n' "CLOUDFLARE_TUNNEL_TOKEN=$CLOUDFLARE_TUNNEL_TOKEN" >> .env
              fi

              $COMPOSE_CMD down --remove-orphans || true
              docker rm -f punjab-voiceai_cloudflared 2>/dev/null || true
              docker image prune -f -a --filter 'until=24h' || true

              echo 'Pulling latest images...'
              $COMPOSE_CMD pull || echo 'Pull failed, will attempt to use local images'

              echo 'Starting services...'
              $COMPOSE_CMD up -d --force-recreate

              sleep 10
              docker ps -a

              FRONTEND_STATUS=$(docker inspect -f '{{.State.Running}}' punjab-voiceai_frontend 2>/dev/null || echo 'false')
              if [ "$FRONTEND_STATUS" != 'true' ]; then
                echo 'Frontend container failed to start. Logs:'
                docker logs punjab-voiceai_frontend | tail -n 20 || true
              else
                echo 'Frontend container is running.'
              fi

              echo 'Waiting for backend container to be running...'
              BACKEND_STATUS=$(docker inspect -f '{{.State.Running}}' punjab-voiceai_backend 2>/dev/null || echo 'false')
              if [ "$BACKEND_STATUS" != 'true' ]; then
                echo 'Backend container failed to start. Logs:'
                docker logs punjab-voiceai_backend | tail -n 20 || true
              else
                echo 'Backend container is running.'
              fi

              # Check MongoDB connection from inside backend
              echo 'Checking MongoDB connection...'
              DB_STATUS='FAIL'
              for i in $(seq 1 6); do
                DB_CHECK=$(docker exec punjab-voiceai_backend node -e "
                  const mongoose = require('mongoose');
                  const uri = process.env.MONGODB_URI || 'mongodb://mongodb:27017/punjabvoice';
                  mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 })
                    .then(() => { console.log('OK'); mongoose.disconnect(); })
                    .catch(() => { console.log('FAIL'); });
                " 2>/dev/null || echo 'FAIL')
                if [ "$DB_CHECK" = 'OK' ]; then
                  DB_STATUS='OK'
                  echo 'MongoDB is connected!'
                  break
                fi
                echo "Attempt $i: MongoDB not ready, waiting..."
                sleep 5
              done
EOF
          '''
        }
      }
    }
  }

  post {
    always {
      echo 'Cleaning up Jenkins workspace...'
      cleanWs()
    }
    success { echo 'Deployment successful!' }
    failure { echo 'Deployment failed!' }
  }
}
