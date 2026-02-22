from app.services.billing_reconcile import map_mp_preapproval_status


def test_map_mp_preapproval_status():
    assert map_mp_preapproval_status("authorized") == "active"
    assert map_mp_preapproval_status("active") == "active"
    assert map_mp_preapproval_status("pending") == "past_due"
    assert map_mp_preapproval_status("paused") == "canceled"
    assert map_mp_preapproval_status("cancelled") == "canceled"
    assert map_mp_preapproval_status("expired") == "expired"
