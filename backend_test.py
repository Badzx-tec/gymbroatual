#!/usr/bin/env python3

import requests
import sys
import json
import os
from datetime import datetime

class GymBroAPITester:
    def __init__(self, base_url=None):
        self.base_url = base_url or os.environ.get('BASE_URL', 'http://localhost:8000')
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
                    return True, response.json(), response
                except:
                    return True, {}, response
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                self.failed_tests.append({
                    "test": name,
                    "endpoint": endpoint,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:200]
                })
                return False, {}, response

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                "test": name,
                "endpoint": endpoint,
                "expected": expected_status,
                "error": str(e)
            })
            return False, {}, None

    def test_health(self):
        """Test health endpoint"""
        success, response, _ = self.run_test("Health Check", "GET", "/api/health", 200)
        return success and response.get("status") == "ok"

    def test_login(self):
        """Test admin login"""
        success, response, _ = self.run_test(
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
        success, response, _ = self.run_test("Dashboard Stats", "GET", "/api/dashboard", 200)
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
        success, students, _ = self.run_test("List Students", "GET", "/api/students", 200)
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
        
        success, created, _ = self.run_test("Create Student", "POST", "/api/students", 200, data=test_student)
        if not success:
            return False
            
        student_id = created.get('student_id')
        if not student_id:
            print("❌ No student_id in create response")
            return False
        
        print(f"✅ Student created with ID: {student_id}")
        
        # Get student
        success, student, _ = self.run_test("Get Student", "GET", f"/api/students/{student_id}", 200)
        if not success or student.get('student_id') != student_id:
            return False
        
        # Update student
        update_data = {"nome": "Updated Test Student", "status": "inativo"}
        success, updated, _ = self.run_test("Update Student", "PUT", f"/api/students/{student_id}", 200, data=update_data)
        if not success or updated.get('nome') != "Updated Test Student":
            return False
        
        # Delete student
        success, _, _ = self.run_test("Delete Student", "DELETE", f"/api/students/{student_id}", 200)
        
        # Verify deletion
        success, _, _ = self.run_test("Verify Student Deleted", "GET", f"/api/students/{student_id}", 404)
        
        return success

    def test_plans_crud(self):
        """Test plans CRUD operations"""
        print("\n🏷️  Testing Plans CRUD...")
        
        # List plans
        success, plans, _ = self.run_test("List Plans", "GET", "/api/plans", 200)
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
        
        success, created, _ = self.run_test("Create Plan", "POST", "/api/plans", 200, data=test_plan)
        if not success:
            return False
            
        plan_id = created.get('plan_id')
        if not plan_id:
            print("❌ No plan_id in create response")
            return False
        
        print(f"✅ Plan created with ID: {plan_id}")
        
        # Update plan
        update_data = {"nome": "Updated Test Plan", "valor": 199.99}
        success, updated, _ = self.run_test("Update Plan", "PUT", f"/api/plans/{plan_id}", 200, data=update_data)
        if not success or updated.get('nome') != "Updated Test Plan":
            return False
        
        # Delete plan
        success, _, _ = self.run_test("Delete Plan", "DELETE", f"/api/plans/{plan_id}", 200)
        
        return success

    def test_public_plans(self):
        """Test public plans endpoint (no auth required)"""
        # Clear token temporarily for public endpoint test
        temp_token = self.token
        self.token = None
        
        success, plans, _ = self.run_test("Public Plans", "GET", "/api/plans/public", 200)
        
        # Restore token
        self.token = temp_token
        
        if success:
            print(f"✅ Public plans returned: {len(plans)} active plans")
            return True
        return False

    def test_access_logs(self):
        """Test access logs endpoint"""
        success, logs, _ = self.run_test("Access Logs", "GET", "/api/access-logs", 200)
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
        
        success, response, _ = self.run_test("Access Validation - Valid RFID", "POST", "/api/access/validate", 200, data=validation_data)
        
        # Test with invalid tag
        invalid_data = {
            "tag_id": "9999999999",
            "tipo": "rfid"
        }
        
        success2, response2, _ = self.run_test("Access Validation - Invalid RFID", "POST", "/api/access/validate", 200, data=invalid_data)
        
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
        
        success, response, _ = self.run_test("Mercado Pago Webhook", "POST", "/api/webhooks/mercadopago", 200, data=webhook_payload)
        
        # Restore token
        self.token = temp_token
        
        if success:
            status = response.get('status', '')
            print(f"✅ Webhook processed with status: {status}")
            return True
        return False

    def test_dashboard_charts(self):
        """Test dashboard charts data endpoint"""
        success, response, _ = self.run_test("Dashboard Charts", "GET", "/api/dashboard/charts", 200)
        if success:
            required_fields = ['receita_por_plano', 'acessos_por_hora', 'alunos_por_status', 'receita_mensal']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field in charts response: {field}")
                    return False
            print(f"✅ Charts fields complete: {len(required_fields)} chart types present")
            print(f"✅ Revenue by plan entries: {len(response.get('receita_por_plano', []))}")
            print(f"✅ Access by hour entries: {len(response.get('acessos_por_hora', []))}")
            return True
        return False

    def test_academies_crud(self):
        """Test academies (multi-tenancy) CRUD operations"""
        print("\n🏢 Testing Academies CRUD...")
        
        # List academies
        success, academies, _ = self.run_test("List Academies", "GET", "/api/academies", 200)
        if not success:
            return False
        
        initial_count = len(academies)
        print(f"✅ Initial academy count: {initial_count}")
        
        # Test academy stats for existing academy if any
        if academies:
            academy_id = academies[0]['academy_id']
            success, stats, _ = self.run_test("Academy Stats", "GET", f"/api/academies/{academy_id}/stats", 200)
            if success:
                required_stats = ['total_alunos', 'alunos_ativos', 'alunos_inativos', 'faturamento']
                for field in required_stats:
                    if field not in stats:
                        print(f"❌ Missing field in academy stats: {field}")
                        return False
                print(f"✅ Academy stats complete for {academy_id}")
        
        # Create academy
        test_academy = {
            "nome": f"Test Academy {datetime.now().strftime('%H%M%S')}",
            "endereco": "Test Address, 123",
            "telefone": "(11) 99999-0000",
            "cnpj": "00.000.000/0001-00",
            "email": "test@academy.com",
            "catraca_ip": "192.168.1.10",
            "catraca_port": 7878,
            "ativo": True
        }
        
        success, created, _ = self.run_test("Create Academy", "POST", "/api/academies", 200, data=test_academy)
        if not success:
            return False
            
        academy_id = created.get('academy_id')
        if not academy_id:
            print("❌ No academy_id in create response")
            return False
        
        print(f"✅ Academy created with ID: {academy_id}")
        
        # Update academy
        update_data = {"nome": "Updated Test Academy", "ativo": False}
        success, updated, _ = self.run_test("Update Academy", "PUT", f"/api/academies/{academy_id}", 200, data=update_data)
        if not success or updated.get('nome') != "Updated Test Academy":
            return False
        
        # Delete academy
        success, _, _ = self.run_test("Delete Academy", "DELETE", f"/api/academies/{academy_id}", 200)
        
        return success

    def test_notifications(self):
        """Test notifications system"""
        print("\n🔔 Testing Notifications...")
        
        # List notifications
        success, notifications, _ = self.run_test("List Notifications", "GET", "/api/notifications", 200)
        if not success:
            return False
        
        initial_count = len(notifications)
        print(f"✅ Initial notification count: {initial_count}")
        
        # Check for expiring subscriptions
        success, response, _ = self.run_test("Check Expiring Subscriptions", "POST", "/api/notifications/check-expiring", 200)
        if not success:
            return False
        
        message = response.get('message', '')
        total_vencendo = response.get('total_vencendo', 0)
        print(f"✅ Expiring check result: {message}")
        print(f"✅ Students expiring in 7 days: {total_vencendo}")
        
        # List notifications again to see if new ones were created
        success, new_notifications, _ = self.run_test("List Notifications After Check", "GET", "/api/notifications", 200)
        if success:
            new_count = len(new_notifications)
            print(f"✅ Notifications after expiring check: {new_count}")
            
            # Test mark as read if we have notifications
            if new_notifications:
                notif_id = new_notifications[0]['notif_id']
                success, _, _ = self.run_test("Mark Notification Read", "PUT", f"/api/notifications/{notif_id}/read", 200)
                if success:
                    print(f"✅ Notification {notif_id} marked as read")
        
        return True

    def test_reports_exports(self):
        """Test report export endpoints (returns binary data)"""
        print("\n📊 Testing Report Exports...")
        
        # Test Excel exports (should return binary data)
        exports = [
            ("Students Excel", "/api/reports/students/excel"),
            ("Students PDF", "/api/reports/students/pdf"),
            ("Access Logs Excel", "/api/reports/access-logs/excel"),
            ("Financial Excel", "/api/reports/financial/excel")
        ]
        
        all_passed = True
        for export_name, endpoint in exports:
            success, _, resp = self.run_test(export_name, "GET", endpoint, 200, headers={'Accept': 'application/octet-stream'})
            if success and resp is not None:
                ctype = resp.headers.get('Content-Type', '')
                size = len(resp.content or b'')
                is_binary = ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' in ctype) or ('application/pdf' in ctype) or ('application/octet-stream' in ctype)
                if not is_binary or size == 0:
                    all_passed = False
                    print(f"❌ {export_name} invalid binary response. content-type={ctype}, size={size}")
                else:
                    print(f"✅ {export_name} export working (content-type={ctype}, size={size})")
            else:
                all_passed = False
                print(f"❌ {export_name} export failed")
        
        return all_passed

    def test_catraca_commands(self):
        """Test catraca remote control commands"""
        print("\n🚪 Testing Catraca Commands...")
        
        # List existing commands
        success, commands, _ = self.run_test("List Catraca Commands", "GET", "/api/catraca/commands", 200)
        if not success:
            return False
        
        initial_count = len(commands)
        print(f"✅ Initial command count: {initial_count}")
        
        # Test different command types
        command_tests = [
            {"action": "release_entry", "message": ""},
            {"action": "release_exit", "message": ""},
            {"action": "block", "message": ""},
            {"action": "message", "message": "TEST MSG"}
        ]
        
        all_passed = True
        for cmd_data in command_tests:
            success, response, _ = self.run_test(f"Catraca Command - {cmd_data['action']}", "POST", "/api/catraca/command", 200, data=cmd_data)
            if success:
                cmd_id = response.get('cmd_id', '')
                status = response.get('status', '')
                print(f"✅ Command {cmd_data['action']} queued with ID: {cmd_id}, status: {status}")
            else:
                all_passed = False
        
        # List commands again to verify they were created
        success, new_commands, _ = self.run_test("List Commands After Creation", "GET", "/api/catraca/commands", 200)
        if success:
            new_count = len(new_commands)
            print(f"✅ Commands after creation: {new_count}")
        
        return all_passed

    def test_seed_data(self):
        """Test seed data endpoint"""
        success, response, _ = self.run_test("Seed Data", "POST", "/api/seed", 200)
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
        ("Dashboard Charts", tester.test_dashboard_charts),
        ("Public Plans", tester.test_public_plans),
        ("Students CRUD", tester.test_students_crud),
        ("Plans CRUD", tester.test_plans_crud),
        ("Access Logs", tester.test_access_logs),
        ("Academies CRUD", tester.test_academies_crud),
        ("Notifications", tester.test_notifications),
        ("Report Exports", tester.test_reports_exports),
        ("Catraca Commands", tester.test_catraca_commands),
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
            error_msg = failure.get('error', f"Expected {failure.get('expected', 'N/A')}, got {failure.get('actual', 'N/A')}")
            print(f"  • {failure['test']}: {error_msg}")
    
    print(f"\n🔗 API Base URL: {tester.base_url}")
    
    return 0 if len(failed_tests) == 0 else 1

if __name__ == "__main__":
    sys.exit(main())