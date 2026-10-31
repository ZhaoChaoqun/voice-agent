import unittest

from airline_lookup_default import check_refund_eligibility, lookup_reservation


class AirlineLookupTests(unittest.TestCase):
    def test_fixed_record_and_ineligible_booking(self):
        record = lookup_reservation("emma_kim_9957", "EHGLP3")
        self.assertTrue(record["mock"])
        self.assertEqual(record["customer_name"], "Emma Kim")
        self.assertEqual(record["reservation"]["user_id"], "emma_kim_9957")
        self.assertEqual(record["reservation"]["reservation_id"], "EHGLP3")
        result = check_refund_eligibility(
            record["reservation"]["created_at"], record["reference_time"]
        )
        self.assertFalse(result["cancellation_with_refund_eligible"])
        self.assertEqual(result["reason"], "booking_older_than_24_hours")
        self.assertAlmostEqual(result["booking_age_hours"], 255.7983333333)
        self.assertFalse(result["reservation_changed"])
        self.assertFalse(result["refund_processed"])

    def test_mock_echoes_unverified_identifiers(self):
        record = lookup_reservation("unverified_user", "OTHER-123")
        self.assertEqual(record["reservation"]["user_id"], "unverified_user")
        self.assertEqual(record["reservation"]["reservation_id"], "OTHER-123")
        self.assertEqual(record["customer_name"], "Emma Kim")

    def test_invalid_identifiers(self):
        for value in ("", " _- ", None, 123):
            for field in ("user_id", "reservation_id"):
                with self.subTest(field=field, value=value):
                    arguments = {"user_id": "user1", "reservation_id": "ABC123"}
                    arguments[field] = value
                    with self.assertRaises(ValueError):
                        lookup_reservation(**arguments)

    def test_24_hour_boundary(self):
        for reference, eligible in (
            ("2024-05-04T23:12:06", True),
            ("2024-05-05T23:12:05", True),
            ("2024-05-05T23:12:06", True),
            ("2024-05-05T23:12:07", False),
        ):
            with self.subTest(reference=reference):
                result = check_refund_eligibility(
                    "2024-05-04T23:12:06", reference
                )
                self.assertEqual(
                    result["cancellation_with_refund_eligible"], eligible
                )
                self.assertFalse(result["reservation_changed"])
                self.assertFalse(result["refund_processed"])

    def test_aware_timestamps_use_offsets(self):
        result = check_refund_eligibility(
            "2024-05-04T23:12:06+00:00", "2024-05-06T00:12:06+01:00"
        )
        self.assertTrue(result["cancellation_with_refund_eligible"])
        self.assertEqual(result["booking_age_hours"], 24)

    def test_invalid_timestamp_pairs(self):
        for created, reference in (
            (None, "2024-05-15T15:00:00"),
            ("2024-05-04T23:12:06", None),
            ("invalid", "2024-05-15T15:00:00"),
            ("2024-05-04T23:12:06", "invalid"),
            ("2024-05-04T23:12:06+00:00", "2024-05-15T15:00:00"),
            ("2024-05-04T23:12:06", "2024-05-15T15:00:00+00:00"),
            ("2024-05-15T15:00:00", "2024-05-04T23:12:06"),
        ):
            with self.subTest(created=created, reference=reference):
                with self.assertRaises(ValueError):
                    check_refund_eligibility(created, reference)


if __name__ == "__main__":
    unittest.main()
