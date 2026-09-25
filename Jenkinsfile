// SIT223/SIT753 Task 7.3HD - ProofSprint DevOps pipeline
// Aaryan Dandona (s224842524)
//
// Seven stages: Build -> Test -> Code Quality -> Security -> Deploy (staging) -> Release (production) -> Monitoring.
// Runs on a Windows Jenkins agent ('bat' steps). All pipeline logic lives in plain Node.js scripts in ci/scripts,
// and every tool (SonarScanner, Trivy, PM2, Prometheus, Alertmanager) is downloaded automatically on first use,
// so cloning the repository and pointing a Pipeline job at this Jenkinsfile is the only setup needed.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    timeout(time: 60, unit: 'MINUTES')
  }

  // Build automatically when a new commit lands on main.
  triggers {
    pollSCM('H/2 * * * *')
  }

  parameters {
    booleanParam(name: 'SIMULATE_INCIDENT', defaultValue: true,
      description: 'Monitoring stage: put production into chaos mode and prove the alert fires, notifies the team and resolves.')
    booleanParam(name: 'SIMULATE_BAD_DEPLOY', defaultValue: false,
      description: 'Deploy stage: make post-deploy verification fail on purpose to demonstrate the automatic rollback.')
    string(name: 'NTFY_TOPIC', defaultValue: 'proofsprint-s224842524-alerts',
      description: 'ntfy.sh topic for team notifications (open https://ntfy.sh/<topic> or subscribe in the ntfy app).')
  }

  environment {
    BASE_VERSION      = '1.0'
    VERSION           = "${BASE_VERSION}.${BUILD_NUMBER}"
    OPS_ROOT          = "${JENKINS_HOME}\\proofsprint-ops"
    SONAR_ORG         = 'automacioai-code'
    SONAR_PROJECT_KEY = 'automacioai-code_SIT223-7.3HD-ProofSprint'
    NTFY_TOPIC        = "${params.NTFY_TOPIC}"
    NPM_CONFIG_UPDATE_NOTIFIER = 'false'
    NPM_CONFIG_FUND   = 'false'
  }

  stages {

    stage('Build') {
      steps {
        script {
          env.GIT_SHA = (env.GIT_COMMIT ?: 'unknown').substring(0, 7)
          currentBuild.displayName = "#${env.BUILD_NUMBER} v${env.VERSION}"
        }
        echo "Building ProofSprint v${env.VERSION} from commit ${env.GIT_SHA}"
        bat 'node --version && call npm --version && git --version'
        // Reproducible install from package-lock.json
        bat 'call npm ci --no-audit'
        // Versioned release folder with build-info.json, production-only dependencies, then the .tgz artefact
        bat "node ci\\scripts\\package.js --version ${env.VERSION} --sha ${env.GIT_SHA} --build ${env.BUILD_NUMBER}"
        dir("dist\\proofsprint-${env.VERSION}") {
          bat 'call npm ci --omit=dev --ignore-scripts --no-audit'
        }
        bat "%SystemRoot%\\System32\\tar.exe -czf dist\\proofsprint-${env.VERSION}.tgz -C dist proofsprint-${env.VERSION}"
        // Checksum + publish to the artefact repository that Deploy and Release install from
        bat "node ci\\scripts\\publish-artifact.js --version ${env.VERSION}"
      }
      post {
        success {
          archiveArtifacts artifacts: 'dist/*.tgz, dist/*.sha256, dist/build-info.json', fingerprint: true
        }
      }
    }

    stage('Test') {
      steps {
        // Lint with the project's custom rules (complexity, size, security plugin); errors fail the build
        bat 'call npm run lint:ci'
        // Unit + integration tests (Jest + Supertest) with coverage thresholds as a pass/fail gate
        bat 'call npm run test:ci'
      }
      post {
        always {
          junit testResults: 'reports/junit.xml', allowEmptyResults: true
          publishHTML(target: [reportName: 'Coverage report', reportDir: 'coverage/lcov-report', reportFiles: 'index.html',
                               keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
        }
      }
    }

    stage('Code Quality') {
      environment {
        // Secret-text credential 'SONAR_TOKEN' (Manage Jenkins > Credentials); masked in the log
        SONAR_TOKEN = credentials('SONAR_TOKEN')
      }
      steps {
        bat 'node ci\\scripts\\sonar.js ensure-project'
        script {
          env.SONAR_SCANNER = bat(script: '@node ci\\scripts\\ensure-tools.js sonar-scanner --print', returnStdout: true).trim()
        }
        // Scanner waits for the SonarCloud quality gate (sonar.qualitygate.wait=true) and fails the stage if it is red
        bat "call \"${env.SONAR_SCANNER}\" -Dsonar.projectVersion=${env.VERSION} -Dsonar.scm.revision=${env.GIT_COMMIT}"
        // Our own thresholds on top of the SonarCloud gate: coverage, duplication, ratings, smells, complexity
        bat 'node ci\\scripts\\sonar.js gate'
      }
    }

    stage('Security') {
      steps {
        // Dependency vulnerabilities (production dependencies are what we ship)
        bat 'call npm audit --omit=dev --json > reports\\npm-audit-prod.json || exit /b 0'
        bat 'call npm audit --json > reports\\npm-audit-all.json || exit /b 0'
        script {
          env.TRIVY = bat(script: '@node ci\\scripts\\ensure-tools.js trivy --print', returnStdout: true).trim()
        }
        // Source tree: dependency CVEs (lockfile), hard-coded secrets and misconfiguration
        bat "\"${env.TRIVY}\" fs --cache-dir \"${env.OPS_ROOT}\\trivy-cache\" --scanners vuln,secret,misconfig --skip-dirs node_modules,dist --format json --output reports\\trivy-source.json ."
        // The exact artefact we deploy (its bundled production node_modules)
        bat "\"${env.TRIVY}\" fs --cache-dir \"${env.OPS_ROOT}\\trivy-cache\" --scanners vuln --format json --output reports\\trivy-artifact.json dist\\proofsprint-${env.VERSION}"
        bat "\"${env.TRIVY}\" fs --cache-dir \"${env.OPS_ROOT}\\trivy-cache\" --scanners vuln --severity HIGH,CRITICAL --format table dist\\proofsprint-${env.VERSION}"
        // Gate: untriaged HIGH/CRITICAL in shipped code or any secret fails the build (triage: security/triage.json)
        bat 'node ci\\scripts\\security-gate.js'
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/security-summary.*, reports/npm-audit-*.json, reports/trivy-*.json', allowEmptyArchive: true
        }
      }
    }

    stage('Deploy') {
      steps {
        bat 'node ci\\scripts\\ensure-tools.js pm2'
        // Installs the artefact on the staging server (PM2, port 3001), runs smoke/API tests, rolls back on failure
        bat "node ci\\scripts\\deploy.js --env staging --version ${env.VERSION}${params.SIMULATE_BAD_DEPLOY ? ' --simulate-failure' : ''}"
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/deploy-staging.json, reports/smoke-staging.json', allowEmptyArchive: true
        }
      }
    }

    stage('Release') {
      steps {
        // Promotes the same verified artefact to production (port 3000) with production configuration
        bat "node ci\\scripts\\deploy.js --env production --version ${env.VERSION}"
        // Git tag v<version>, release manifest and release notes
        bat "node ci\\scripts\\release.js --version ${env.VERSION}"
        script {
          currentBuild.description = "Released v${env.VERSION} (${env.GIT_SHA}) to production: http://127.0.0.1:3000"
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/deploy-production.json, reports/smoke-production.json, reports/release-*', allowEmptyArchive: true
        }
      }
    }

    stage('Monitoring') {
      steps {
        bat 'node ci\\scripts\\ensure-tools.js prometheus alertmanager'
        // Prometheus + alert rules, Alertmanager and the team notifier, provisioned from monitoring/ and verified
        bat "node ci\\scripts\\monitoring.js up --ntfy-topic ${params.NTFY_TOPIC}"
        script {
          if (params.SIMULATE_INCIDENT) {
            // Chaos mode in production -> alert fires -> team notified -> recovery -> alert resolves
            bat 'node ci\\scripts\\incident-sim.js'
          } else {
            echo 'Incident simulation skipped (SIMULATE_INCIDENT=false)'
          }
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/monitoring-*, reports/incident-*', allowEmptyArchive: true
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reports/*.md', allowEmptyArchive: true
    }
    success {
      bat "node ci\\scripts\\notify.js --status SUCCESS --topic ${params.NTFY_TOPIC}"
    }
    failure {
      bat "node ci\\scripts\\notify.js --status FAILURE --topic ${params.NTFY_TOPIC}"
    }
  }
}
