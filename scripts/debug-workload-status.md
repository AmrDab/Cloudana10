# Debugging "Status Not Available" Issue

## Problem
Workload shows "Status Not Available" on the UI deployment page.

## Root Causes & Solutions

### 1️⃣  **Workload Not Registered for Polling**
**Symptom:** Orchestrator logs show "Workload X/Y not registered for polling"

**Solution:**
```bash
# Check orchestrator logs
grep "Workload 4" /root/.cursor/projects/home-akash-repo/terminals/2.txt

# If you see "not registered for polling", manually register it:
cd /home/akash-repo/cloudana-mvp
tsx scripts/register-workload-for-polling.ts 4 1 http://YOUR_PROVIDER_IP:8080
```

### 2️⃣  **Provider Not Responding**
**Symptom:** Provider health check fails or times out

**Check Provider Status:**
```bash
# Test provider directly
curl http://YOUR_PROVIDER_IP:8080/health

# Check if provider node server is running
# (On the provider machine)
pm2 status
pm2 logs provider-node

# Restart provider if needed
pm2 restart provider-node
```

### 3️⃣  **Wrong Provider Endpoint**
**Symptom:** Provider URL is unreachable or incorrect

**Verify from Blockchain:**
```bash
# Check what endpoint is registered on-chain
# Go to: http://localhost:5173/providers
# Find your provider and check the endpoint URL

# Or query directly:
curl 'http://localhost:5173/api/blockchain/providers' | jq '.[] | {owner, endpoint}'
```

### 4️⃣  **Workload Never Deployed**
**Symptom:** Provider doesn't have the workload

**Check Provider Logs:**
```bash
# On provider machine
pm2 logs provider-node --lines 100 | grep "Workload 4"

# Check if deployment succeeded
curl http://YOUR_PROVIDER_IP:8080/status
```

### 5️⃣  **Firewall/Network Issues**
**Symptom:** Connection timeouts

**Check Network:**
```bash
# Test connectivity from orchestrator to provider
ping YOUR_PROVIDER_IP
telnet YOUR_PROVIDER_IP 8080

# Check firewall rules (on provider machine)
sudo ufw status
sudo ufw allow 8080/tcp  # If needed
```

## Quick Fix for Workload 4

Based on the issue, here's what to do:

1. **Find the correct provider endpoint:**
   - Go to http://localhost:5173/providers
   - Find provider `0xF29283Dc1dD9d64C5B3FC1e1DD19C0f0B998Ac61A`
   - Note the endpoint URL

2. **Check if provider is online:**
   ```bash
   curl http://PROVIDER_ENDPOINT/health
   ```

3. **Check if workload was deployed:**
   ```bash
   curl http://PROVIDER_ENDPOINT/workload/4/1/status
   ```

4. **If provider is online but workload not registered:**
   ```bash
   cd /home/akash-repo/cloudana-mvp
   tsx scripts/register-workload-for-polling.ts 4 1 http://PROVIDER_ENDPOINT
   ```

5. **If workload wasn't deployed, re-deploy manually:**
   - Go to http://localhost:5173/orchestrator
   - Click "Execute Placement" for workload 4
   - This will trigger a fresh deployment and auto-register for polling

## Prevention

To avoid this in the future:

1. **Always use the orchestrator loop** - It automatically registers workloads
2. **Verify provider health before deployment** - Check `/health` endpoint
3. **Monitor orchestrator logs** - Watch for deployment confirmations
4. **Test provider endpoint** - Ensure it's publicly accessible

## Common Provider Endpoint Issues

- ❌ `http://localhost:8080` - Not accessible from orchestrator
- ❌ `http://192.168.x.x:8080` - Private IP, not accessible over internet
- ✅ `http://PUBLIC_IP:8080` - Correct format
- ✅ `http://provider.domain.com:8080` - Domain also works

## Testing Tools

```bash
# Use the diagnostic script
cd /home/akash-repo/cloudana-mvp
./scripts/check-provider-workload.sh http://PROVIDER_IP:8080 4 1

# Check orchestrator polling service
curl http://localhost:7002/v1/workload-status/4/1

# Force refresh status (if registered)
curl 'http://localhost:7002/v1/workload-status/4/1?refresh=true'
```
