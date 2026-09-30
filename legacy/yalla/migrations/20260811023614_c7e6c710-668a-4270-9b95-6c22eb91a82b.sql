CREATE OR REPLACE FUNCTION public.classify_lineage_applicability(_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tx record; scanned int := 0; na int := 0; recorded int := 0; direct boolean;
  drv uuid; started timestamptz;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_trusted_backend_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  FOR tx IN SELECT * FROM commercial_transactions ORDER BY created_at LIMIT _limit LOOP
    scanned := scanned + 1;
    direct := tx.opportunity_id IS NULL AND tx.quote_id IS NULL
          AND tx.offer_ref IS NULL AND tx.commitment_id IS NULL
          AND tx.demand_intent_ref IS NULL;

    -- Stages 1-4: pre-booking commercial funnel
    IF direct THEN
      PERFORM record_lineage_stage(tx.id, 1::smallint, 'market_signal', NULL, NULL,
        'not_applicable', tx.created_at, 'lineage_applicability', 'system', NULL,
        jsonb_build_object('reason',
          'Direct on-demand booking: no market signal precedes an instant request on this channel.'));
      PERFORM record_lineage_stage(tx.id, 2::smallint, 'opportunity_intent', NULL, NULL,
        'not_applicable', tx.created_at, 'lineage_applicability', 'system', NULL,
        jsonb_build_object('reason',
          'Direct on-demand booking: no commercial opportunity was worked for this transaction.'));
      PERFORM record_lineage_stage(tx.id, 3::smallint, 'offer', NULL, NULL,
        'not_applicable', tx.created_at, 'lineage_applicability', 'system', NULL,
        jsonb_build_object('reason',
          'Direct on-demand booking: fare was quoted at request time, not through a negotiated offer.'));
      PERFORM record_lineage_stage(tx.id, 4::smallint, 'capacity_commitment', NULL, NULL,
        'not_applicable', tx.created_at, 'lineage_applicability', 'system', NULL,
        jsonb_build_object('reason',
          'Direct on-demand booking: capacity was matched live, not committed in advance.'));
      na := na + 4;
    END IF;

    -- Stage 6: orchestration evidence held on the booking record itself
    IF tx.dispatch_assignment_id IS NULL AND tx.booking_table = 'trip_bookings' AND tx.booking_id IS NOT NULL THEN
      SELECT driver_id, started_at INTO drv, started FROM trip_bookings WHERE id = tx.booking_id;
      IF drv IS NOT NULL THEN
        PERFORM record_lineage_stage(tx.id, 6::smallint, 'orchestration', drv::text, 'trip_bookings',
          'recorded', COALESCE(started, tx.booked_at, tx.created_at), 'lineage_applicability',
          'system', NULL,
          jsonb_build_object('evidence', 'driver_assignment_on_booking', 'driver_id', drv));
        recorded := recorded + 1;
      END IF;
    END IF;

    -- Stage 8: invoicing only applies to corporate-billed work
    IF tx.invoice_id IS NULL AND tx.corporate_id IS NULL THEN
      PERFORM record_lineage_stage(tx.id, 8::smallint, 'invoice', NULL, NULL,
        'not_applicable', tx.created_at, 'lineage_applicability', 'system', NULL,
        jsonb_build_object('reason',
          'Pay-as-you-go transaction: no corporate invoice is raised, the customer settles at the point of service.'));
      na := na + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', scanned,
    'stages_not_applicable', na, 'stages_recorded', recorded,
    'note', 'Stages were classified as not applicable only where no such artefact exists for the channel; each carries a written reason.');
END; $$;

REVOKE ALL ON FUNCTION public.classify_lineage_applicability(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.classify_lineage_applicability(integer) TO authenticated, service_role;