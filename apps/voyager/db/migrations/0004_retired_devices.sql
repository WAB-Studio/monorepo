ALTER TABLE "reading"."devices" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER POLICY "lookups_insert_self" ON "reading"."lookups" TO authenticated WITH CHECK ((select auth.uid()) = "reading"."lookups"."user_id" and not exists (
        select 1 from reading.devices d
        where d.user_id = "reading"."lookups"."user_id" and d.device_id = "reading"."lookups"."device_id" and d.retired_at is not null
      ));
--> statement-breakpoint
-- A retirement is final (RL-24): once `retired_at` is set no update may change it, not even back to null.
CREATE FUNCTION "reading"."devices_retired_is_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.retired_at IS NOT NULL AND new.retired_at IS DISTINCT FROM old.retired_at THEN
    RAISE EXCEPTION 'a retired device stays retired' USING ERRCODE = 'check_violation';
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "reading"."devices_retired_is_final"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "devices_retired_is_final" BEFORE UPDATE ON "reading"."devices"
  FOR EACH ROW EXECUTE FUNCTION "reading"."devices_retired_is_final"();
--> statement-breakpoint
-- `label` is refreshed on every sync round; `retired_at` is set by the retire route.
GRANT UPDATE (retired_at, label) ON TABLE "reading"."devices" TO "authenticated";
--> statement-breakpoint
-- A device that never synced is retired by inserting its row already marked.
GRANT INSERT (retired_at) ON TABLE "reading"."devices" TO "authenticated";
