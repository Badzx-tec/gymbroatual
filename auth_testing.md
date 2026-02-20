# Auth-Gated App Testing Playbook for GymBro

## Step 1: Create Test User & Session
```bash
mongosh --eval "
use('gymbro');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  password: '',
  role: 'admin',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Test Backend API
```bash
API_URL="https://dc844492-030e-4afd-8c2e-9ccf8817b6b9.preview.emergentagent.com"

# Test health
curl -s "$API_URL/api/health"

# Test login with existing admin
curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@gymbro.com","password":"admin123"}'

# Use token from login for subsequent requests
TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@gymbro.com","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s "$API_URL/api/dashboard" -H "Authorization: Bearer $TOKEN"
curl -s "$API_URL/api/students" -H "Authorization: Bearer $TOKEN"
curl -s "$API_URL/api/plans" -H "Authorization: Bearer $TOKEN"
curl -s "$API_URL/api/access-logs" -H "Authorization: Bearer $TOKEN"
```

## Step 3: Browser Testing
```python
# Set cookie for session testing
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "dc844492-030e-4afd-8c2e-9ccf8817b6b9.preview.emergentagent.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto("https://dc844492-030e-4afd-8c2e-9ccf8817b6b9.preview.emergentagent.com/admin")
```

## Admin Credentials
- Email: admin@gymbro.com
- Password: admin123
- DB: gymbro
