-- Historical compatibility marker for an early dashboard migration that is
-- already present in the pre-release Production database.
-- Original migration name: add_erp_inventory_phase_1
-- Original statements SHA-256: 45adb1959085efe973f3523daaa2394b255051b21d33346f60633ed83a855380
-- The maintained idempotent forward reconciliation remains
-- 20260703130000_add_erp_inventory_phase_1.sql so legacy databases converge safely.
select 1;
