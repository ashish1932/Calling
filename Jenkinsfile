pipeline {
    agent any

    environment {
        DOCKER_BUILDKIT = '1'

        // ── Credentials IDs ─────────────────────────────────────────────────
        VM_SSH_CRED_ID    = "punjab-voiceai"        // Jenkins SSH key credential ID
        GITHUB_CRED_ID    = "github-cred"           // Jenkins GitHub credential ID
        DOCKERHUB_CRED_ID = "dockerhub-creds"       // Jenkins Docker Hub credential ID
        ENV_FILE_CRED_ID  = "punjab-voiceai-env"    // Jenkins Secret File credential ID (stores the .env file for the VM)

        // ── Docker Image Names ──────────────────────────────────────────────
        BACKEND_IMAGE  = "casdevops/punjab-voice-backend"
        FRONTEND_IMAGE = "casdevops/punjab-voice-frontend"

        // ── VM Deployment Target ────────────────────────────────────────────
        VM_USER    = "cubeai"
        VM_HOST    = "192.168.1.38"
        VM_APP_DIR = "/home/cubeai/punjab-voice-app"

        // ── Git Configuration ───────────────────────────────────────────────
        GIT_BRANCH = "deploy"
        GIT_URL    = "https://github.com/cubeaisolutionstech/Punjab-voice-AI-Assistant-.git"

        // ── Source Directories (match your repo folder names) ───────────────
        BACKEND_DIR  = "backend"
        FRONTEND_DIR = "frontend"
    }

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {

        // ── 1. Verify SSH to VM ─────────────────────────────────────────────
        stage('🔌 Verify VM SSH Connection') {
            steps {
                echo '🔌 Testing SSH connection to VM...'
                withCredentials([sshUserPrivateKey(
                    credentialsId: "${VM_SSH_CRED_ID}",
                    keyFileVariable: 'SSH_KEY'
                )]) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $SSH_KEY \
                            ${VM_USER}@${VM_HOST} 'echo "🔑 SSH OK — $(hostname)"'
                    '''
                }
            }
        }

        // ── 1.5. Ensure Docker & Docker Compose on VM ──────────────────────
        stage('🛠️ Ensure Docker on VM') {
            steps {
                echo '🛠️ Checking and installing Docker & Docker Compose on VM if missing...'
                withCredentials([sshUserPrivateKey(
                    credentialsId: "${VM_SSH_CRED_ID}",
                    keyFileVariable: 'SSH_KEY'
                )]) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no -i $SSH_KEY $VM_USER@$VM_HOST "
                            sudo apt-get update -y

                            if ! command -v docker > /dev/null 2>&1; then
                                echo '🐳 Docker not installed. Installing...'
                                sudo apt-get install -y ca-certificates curl gnupg lsb-release
                                sudo mkdir -p /etc/apt/keyrings
                                sudo rm -f /etc/apt/keyrings/docker.gpg
                                curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
                                    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

                                ARCH=\\$(dpkg --print-architecture)
                                CODENAME=\\$(lsb_release -cs 2>/dev/null || \
                                    (. /etc/os-release && echo \\$VERSION_CODENAME))

                                echo \\"deb [arch=\\\$ARCH signed-by=/etc/apt/keyrings/docker.gpg] \
                                    https://download.docker.com/linux/ubuntu \\\$CODENAME stable\\" | \
                                    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

                                sudo apt-get update -y
                                sudo apt-get install -y docker-ce docker-ce-cli containerd.io
                            else
                                echo '🐳 Docker already installed.'
                            fi

                            if ! docker compose version > /dev/null 2>&1; then
                                echo '🐳 Docker Compose v2 not installed. Installing plugin...'
                                sudo apt-get install -y docker-compose-plugin
                            else
                                echo '🐳 Docker Compose already installed.'
                            fi

                            if ! groups \$USER | grep -qw docker; then
                                sudo usermod -aG docker \$USER
                                echo '🐳 Added user to docker group.'
                            else
                                echo '🐳 User already in docker group.'
                            fi
                        "
                    '''
                }
            }
        }

        // ── 2. Checkout Source Code ─────────────────────────────────────────
        stage('📥 Checkout Code') {
            steps {
                echo '📥 Fetching source code...'
                git branch: "${GIT_BRANCH}",
                    url: "${GIT_URL}",
                    credentialsId: "${GITHUB_CRED_ID}"
            }
        }

        // ── 3. Build & Push Backend ─────────────────────────────────────────
        stage('🐳 Build & Push Backend Image') {
            steps {
                echo '🔨 Building backend Docker image...'
                dir("${BACKEND_DIR}") {
                    sh "docker build --no-cache -t ${BACKEND_IMAGE}:latest ."
                }
                withCredentials([usernamePassword(
                    credentialsId: "${DOCKERHUB_CRED_ID}",
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_PASSWORD'
                )]) {
                    sh """
                        echo \$DOCKERHUB_PASSWORD | docker login -u \$DOCKERHUB_USER --password-stdin
                        docker push ${BACKEND_IMAGE}:latest
                    """
                }
            }
        }

        // ── 4. Build & Push Frontend ────────────────────────────────────────
        stage('🐳 Build & Push Frontend Image') {
            steps {
                echo '🔨 Building frontend Docker image...'
                dir("${FRONTEND_DIR}") {
                    sh "docker build --no-cache -t ${FRONTEND_IMAGE}:latest ."
                }
                withCredentials([usernamePassword(
                    credentialsId: "${DOCKERHUB_CRED_ID}",
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_PASSWORD'
                )]) {
                    sh """
                        echo \$DOCKERHUB_PASSWORD | docker login -u \$DOCKERHUB_USER --password-stdin
                        docker push ${FRONTEND_IMAGE}:latest
                    """
                }
            }
        }

        // ── 6. Sync Files + Inject .env to VM ──────────────────────────────
        stage('📂 Copy Config to VM') {
            steps {
                echo '📁 Copying project files to VM...'
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${VM_SSH_CRED_ID}",
                        keyFileVariable: 'SSH_KEY'
                    ),
                    file(
                        credentialsId: "${ENV_FILE_CRED_ID}",  // Secret File credential
                        variable: 'SECRET_ENV_FILE'            // Jenkins-managed tmp path
                    )
                ]) {
                    sh '''
                        # Ensure destination directory exists on VM
                        ssh -o StrictHostKeyChecking=no -i $SSH_KEY \
                            ${VM_USER}@${VM_HOST} "mkdir -p ${VM_APP_DIR}"

                        # Sync project files — .env is explicitly excluded
                        rsync -avz --delete \
                            -e "ssh -o StrictHostKeyChecking=no -i $SSH_KEY" \
                            --exclude='.git' \
                            --exclude='.env' \
                            --exclude='node_modules' \
                            --exclude='**/node_modules' \
                            --exclude='__pycache__' \
                            --exclude='*.log' \
                            --exclude='docker-compose.override.yml' \
                            ./ ${VM_USER}@${VM_HOST}:${VM_APP_DIR}/

                        # Securely copy the secret .env file to the VM
                        # $SECRET_ENV_FILE is the Jenkins-managed temp path for the secret file
                        scp -o StrictHostKeyChecking=no -i $SSH_KEY \
                            "$SECRET_ENV_FILE" ${VM_USER}@${VM_HOST}:${VM_APP_DIR}/.env

                        # Lock down permissions — owner read/write only
                        ssh -o StrictHostKeyChecking=no -i $SSH_KEY \
                            ${VM_USER}@${VM_HOST} "chmod 600 ${VM_APP_DIR}/.env"
                    '''
                }
            }
        }

        // ── 7. Pull Images & Deploy on VM ───────────────────────────────────
        stage('🚀 Deploy to proxmox VM') {
            steps {
                echo '🚀 Deploying application on VM...'
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${VM_SSH_CRED_ID}",
                        keyFileVariable: 'SSH_KEY'
                    ),
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CRED_ID}",
                        usernameVariable: 'DOCKERHUB_USER',
                        passwordVariable: 'DOCKERHUB_PASSWORD'
                    )
                ]) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no -i $SSH_KEY $VM_USER@$VM_HOST "

                            # Sanity check: abort if .env is missing
                            if [ ! -f '${VM_APP_DIR}/.env' ]; then
                                echo 'ERROR: .env file not found at ${VM_APP_DIR}/.env — aborting.' >&2
                                exit 1
                            fi

                            echo '$DOCKERHUB_PASSWORD' | docker login -u '$DOCKERHUB_USER' --password-stdin &&

                            docker pull $BACKEND_IMAGE:latest &&
                            docker pull $FRONTEND_IMAGE:latest &&

                            cd $VM_APP_DIR &&
                            (docker compose down || docker-compose down) &&
                            (docker compose up -d --force-recreate || docker-compose up -d --force-recreate) &&
                            docker image prune -af --filter 'until=12h' &&
                            docker ps
                        "
                    '''
                }
            }
        }
    }

    post {
        always {
            echo '🧹 Cleaning up Jenkins workspace...'
            cleanWs()
        }
        success { echo '✅ Deployment successful!' }
        failure { echo '❌ Deployment failed!' }
    }
}
