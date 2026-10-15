#!/usr/bin/env bash
set -e

echo "============================================="
echo "   Liner Music Self-hosted Server Setup      "
echo "============================================="

# 1. Open firewall port 3000 on Oracle Linux / Ubuntu
if command -v iptables &> /dev/null; then
  echo "==> Configuring iptables for port 3000..."
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
  if command -v netfilter-persistent &> /dev/null; then
    sudo netfilter-persistent save || true
  fi
fi

if command -v ufw &> /dev/null; then
  echo "==> Configuring UFW..."
  sudo ufw allow 3000/tcp || true
fi

# 2. Check Docker
if command -v docker &> /dev/null; then
  echo "==> Docker found. Starting with docker compose..."
  docker compose down || true
  docker compose up -d --build
  echo "==> Server started in background via Docker!"
else
  # 3. Fallback to Node.js
  echo "==> Docker not found, checking Node.js..."
  if ! command -v node &> /dev/null; then
    echo "==> Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  npm install
  nohup node server.js > server.log 2>&1 &
  echo "==> Server started in background via Node.js! Logs in server.log"
fi

IP=$(curl -s https://api.ipify.org || echo "YOUR_VPS_IP")
echo "============================================="
echo " Server is ready!"
echo " Public Endpoint: http://$IP:3000"
echo " Test with: curl http://$IP:3000/health"
echo "============================================="
echo " Open Liner Desktop -> Settings -> Playback"
echo " Select 'Tùy chỉnh' (Custom) and paste: http://$IP:3000"
echo "============================================="
