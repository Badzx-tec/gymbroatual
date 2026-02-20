#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class GymBroAPITester:
    def __init__(self, base_url="https://dc844492-030e-4afd-8c2e-9ccf8817b6b9.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers, timeout=30)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers, timeout=30)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers, timeout=30)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers, timeout=30)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                self.failed_tests.append({
                    "test": name,
                    "endpoint": endpoint,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:200]
                })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                "test": name,
                "endpoint": endpoint,
                "expected": expected_status,
                "error": str(e)
            })
            return False, {}

    def test_health(self):
        """Test health endpoint"""
        success, response = self.run_test("Health Check", "GET", "/api/health", 200)
        return success and response.get("status") == "ok"

    def test_login(self):
        """Test admin login"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "/api/auth/login",
            200,
            data={"email": "admin@gymbro.com", "password": "admin123"}
        )
        if success and 'token' in response:
            self.token = response['token']
            print(f"✅ Token received: {self.token[:20]}...")
            return True
        return False

    def test_dashboard(self):
        """Test dashboard stats"""
        success, response = self.run_test("Dashboard Stats", "GET", "/api/dashboard", 200)
        if success:
            required_fields = ['total_alunos', 'alunos_ativos', 'alunos_inativos', 
                             'total_planos', 'faturamento_mensal', 'acessos_hoje', 'ultimos_acessos']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field in dashboard response: {field}")
                    return False
            print(f"✅ Dashboard fields complete: {len(required_fields)} fields present")
            return True
        return False

    def test_students_crud(self):
        """Test students CRUD operations"""
        print("\n📋 Testing Students CRUD...")
        
        # List students
        success, students = self.run_test("List Students", "GET", "/api/students", 200)
        if not success:
            return False
        
        initial_count = len(students)
        print(f"✅ Initial student count: {initial_count}")
        
        # Create student
        test_student = {
            "nome": f"Test Student {datetime.now().strftime('%H%M%S')}",
            "email": f"test{datetime.now().strftime('%H%M%S')}@test.com",
            "cpf": f"999.888.777-{datetime.now().strftime('%S')}",
            "telefone": "(11) 99999-9999",
            "status": "ativo"
        }
        
        success, created = self.run_test("Create Student", "POST", "/api/students", 200, data=test_student)
        if not success:
            return False
            
        student_id = created.get('student_id')
        if not student_id:
            print("❌ No student_id in create response")
            return False
        
        print(f"✅ Student created with ID: {student_id}")
        
        # Get student
        success, student = self.run_test("Get Student", "GET", f"/api/students/{student_id}", 200)
        if not success or student.get('student_id') != student_id:
            return False
        
        # Update student
        update_data = {"nome": "Updated Test Student", "status": "inativo"}
        success, updated = self.run_test("Update Student", "PUT", f"/api/students/{student_id}", 200, data=update_data)
        if not success or updated.get('nome') != "Updated Test Student":
            return False
        
        # Delete student
        success, _ = self.run_test("Delete Student", "DELETE", f"/api/students/{student_id}", 200)
        
        # Verify deletion
        success, _ = self.run_test("Verify Student Deleted", "GET", f"/api/students/{student_id}", 404)
        
        return success

    def test_plans_crud(self):
        """Test plans CRUD operations"""
        print("\n🏷️  Testing Plans CRUD...")
        
        # List plans
        success, plans = self.run_test("List Plans", "GET", "/api/plans", 200)
        if not success:
            return False
        
        initial_count = len(plans)
        print(f"✅ Initial plan count: {initial_count}")
        
        # Create plan
        test_plan = {
            "nome": f"Test Plan {datetime.now().strftime('%H%M%S')}",
            "valor": 99.99,
            "duracao_dias": 30,
            "descricao": "Test plan description",
            "ativo": True
        }
        
        success, created = self.run_test("Create Plan", "POST", "/api/plans", 200, data=test_plan)
        if not success:
            return False
            
        plan_id = created.get('plan_id')
        if not plan_id:
            print("❌ No plan_id in create response")
            return False
        
        print(f"✅ Plan created with ID: {plan_id}")
        
        # Update plan
        update_data = {"nome": "Updated Test Plan", "valor": 199.99}
        success, updated = self.run_test("Update Plan", "PUT", f"/api/plans/{plan_id}", 200, data=update_data)
        if not success or updated.get('nome') != "Updated Test Plan":
            return False
        
        # Delete plan
        success, _ = self.run_test("Delete Plan", "DELETE", f"/api/plans/{plan_id}", 200)
        
        return success

    def test_public_plans(self):
        """Test public plans endpoint (no auth required)"""
        # Clear token temporarily for public endpoint test
        temp_token = self.token
        self.token = None
        
        success, plans = self.run_test("Public Plans", "GET", "/api/plans/public", 200)
        
        # Restore token
        self.token = temp_token
        
        if success:
            print(f"✅ Public plans returned: {len(plans)} active plans")
            return True
        return False

    def test_access_logs(self):
        """Test access logs endpoint"""
        success, logs = self.run_test("Access Logs", "GET", "/api/access-logs", 200)
        if success:
            print(f"✅ Access logs returned: {len(logs)} log entries")
            return True
        return False

    def test_access_validation(self):
        """Test turnstile access validation"""
        # Clear token for this endpoint (local agent access)
        temp_token = self.token
        self.token = None
        
        # Test with existing RFID tag from seed data
        validation_data = {
            "tag_id": "0000000001",
            "tipo": "rfid"
        }
        
        success, response = self.run_test("Access Validation - Valid RFID", "POST", "/api/access/validate", 200, data=validation_data)
        
        # Test with invalid tag
        invalid_data = {
            "tag_id": "9999999999",
            "tipo": "rfid"
        }
        
        success2, response2 = self.run_test("Access Validation - Invalid RFID", "POST", "/api/access/validate", 200, data=invalid_data)
        
        # Restore token
        self.token = temp_token
        
        if success and success2:
            valid_access = response.get('autorizado', False)
            invalid_access = response2.get('autorizado', False)
            print(f"✅ Valid tag authorized: {valid_access}, Invalid tag authorized: {invalid_access}")
            return valid_access and not invalid_access
        
        return False

    def test_mercadopago_webhook(self):
        """Test Mercado Pago webhook endpoint"""
        # Clear token for webhook endpoint
        temp_token = self.token
        self.token = None
        
        webhook_payload = {
            "action": "payment.created",
            "data": {
                "id": "123456789"
            }
        }
        
        success, response = self.run_test("Mercado Pago Webhook", "POST", "/api/webhooks/mercadopago", 200, data=webhook_payload)
        
        # Restore token
        self.token = temp_token
        
        if success:
            status = response.get('status', '')
            print(f"✅ Webhook processed with status: {status}")
            return True
        return False

    def test_seed_data(self):
        """Test seed data endpoint"""
        success, response = self.run_test("Seed Data", "POST", "/api/seed", 200)
        if success:
            message = response.get('message', '')
            print(f"✅ Seed response: {message}")
            return True
        return False

def main():
    print("🚀 Starting GymBro API Tests...")
    print("=" * 50)
    
    tester = GymBroAPITester()
    
    # Test sequence
    tests = [
        ("Health Check", tester.test_health),
        ("Seed Data", tester.test_seed_data),
        ("Admin Login", tester.test_login),
        ("Dashboard Stats", tester.test_dashboard),
        ("Public Plans", tester.test_public_plans),
        ("Students CRUD", tester.test_students_crud),
        ("Plans CRUD", tester.test_plans_crud),
        ("Access Logs", tester.test_access_logs),
        ("Access Validation", tester.test_access_validation),
        ("Mercado Pago Webhook", tester.test_mercadopago_webhook),
    ]
    
    passed_tests = []
    failed_tests = []
    
    for test_name, test_func in tests:
        try:
            print(f"\n{'='*20} {test_name} {'='*20}")
            result = test_func()
            if result:
                passed_tests.append(test_name)
                print(f"✅ {test_name} - PASSED")
            else:
                failed_tests.append(test_name)
                print(f"❌ {test_name} - FAILED")
        except Exception as e:
            failed_tests.append(test_name)
            print(f"💥 {test_name} - EXCEPTION: {str(e)}")
    
    # Print final results
    print("\n" + "="*50)
    print(f"📊 FINAL RESULTS")
    print(f"Total Tests: {len(tests)}")
    print(f"✅ Passed: {len(passed_tests)} ({len(passed_tests)/len(tests)*100:.1f}%)")
    print(f"❌ Failed: {len(failed_tests)} ({len(failed_tests)/len(tests)*100:.1f}%)")
    
    if passed_tests:
        print(f"\n✅ Passed Tests: {', '.join(passed_tests)}")
    
    if failed_tests:
        print(f"\n❌ Failed Tests: {', '.join(failed_tests)}")
        
    if tester.failed_tests:
        print(f"\n🔍 Failed Test Details:")
        for failure in tester.failed_tests:
            print(f"  • {failure['test']}: {failure.get('error', f\"Expected {failure['expected']}, got {failure['actual']}\")}")
    
    print(f"\n🔗 API Base URL: {tester.base_url}")
    
    return 0 if len(failed_tests) == 0 else 1

if __name__ == "__main__":
    sys.exit(main())