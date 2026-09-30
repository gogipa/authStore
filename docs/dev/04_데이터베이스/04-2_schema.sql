-- 04-2. 전체 스키마 DDL (PostgreSQL 14 이상)
-- 생성: prisma migrate diff --from-empty --to-schema 04-3_schema.prisma (Prisma 7.10.0) + 04-3 맨 아래 'Prisma 밖 SQL'
-- 2026-09-27 로컬 PostgreSQL 14.20 새 DB에 ON_ERROR_STOP으로 적용 확인(ERD v0.4: 테이블 55, CHECK 258, FK 75, 부분·식 인덱스 11, 트리거 49. 적용한 DB → 스키마 migrate diff 빈 결과). 원본은 04-1_ERD.md → 04-3_schema.prisma이며 이 파일은 파생물이다.
-- 2026-09-30 v0.5(P2-01 Proposed): ck_kws_abort_reason에 NETWORK_ERROR·APP_RESTART·INTERRUPTED를 더했다(V2 마이그레이션 04-6_V2__keyword_abort_reasons.sql, 표·열 수는 그대로).

-- ===== 1. Prisma가 만드는 테이블·FK·UNIQUE·인덱스 =====
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "candidate" (
    "id" SERIAL NOT NULL,
    "creation_path" VARCHAR(16) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'WORKING',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluded_reason" VARCHAR(24),
    "source_keyword_id" INTEGER,
    "rakuten_query" VARCHAR(128),
    "source_url" VARCHAR(2048),
    "anchor_model_code" VARCHAR(128),
    "anchor_item_code" VARCHAR(128),
    "anchor_color_code" VARCHAR(64),
    "anchor_fixed_at" TIMESTAMPTZ(6),
    "item_code" VARCHAR(128),
    "selected_color" VARCHAR(128),
    "gender" VARCHAR(8),
    "gender_source" VARCHAR(8),
    "gender_recheck_required" BOOLEAN NOT NULL DEFAULT false,
    "leaf_category_id" VARCHAR(20),
    "whole_category_name" VARCHAR(500),
    "no_comparison_confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_status_history" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "from_status" VARCHAR(24),
    "to_status" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "step_run_id" INTEGER,
    "gate_pass_id" INTEGER,
    "registration_id" INTEGER,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_step" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "step_code" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NOT_RUN',
    "current_step_run_id" INTEGER,
    "last_version" INTEGER NOT NULL DEFAULT 0,
    "stale_inputs" VARCHAR(64)[] DEFAULT ARRAY[]::VARCHAR(64)[],
    "stale_since" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_run" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "step_code" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL,
    "execution_mode" VARCHAR(12) NOT NULL,
    "owner_action" VARCHAR(16),
    "base_step_run_id" INTEGER,
    "step_chain_id" INTEGER,
    "settings_snapshot_id" INTEGER NOT NULL,
    "ai_engine" VARCHAR(16),
    "ai_model" VARCHAR(100),
    "ai_cli_version" VARCHAR(40),
    "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    "failure_kind" VARCHAR(20),
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "input_fingerprint_start" CHAR(64) NOT NULL,
    "input_fingerprint_end" CHAR(64),
    "rerun_reason_inputs" VARCHAR(64)[] DEFAULT ARRAY[]::VARCHAR(64)[],
    "waiting_since" TIMESTAMPTZ(6),
    "wait_seconds_total" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "step_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_run_input" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "input_key" VARCHAR(64) NOT NULL,
    "source_type" VARCHAR(12) NOT NULL,
    "source_step_run_id" INTEGER,
    "is_start_condition" BOOLEAN NOT NULL,
    "value_hash" CHAR(64) NOT NULL,

    CONSTRAINT "step_run_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_pass" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "gate" VARCHAR(2) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "fingerprint_basis" JSONB NOT NULL,
    "basis_step_run_id" INTEGER NOT NULL,
    "basis_step_code" VARCHAR(16) NOT NULL,
    "passed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_chain" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "start_step_code" VARCHAR(16),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "stop_reason" VARCHAR(24),
    "stop_step_code" VARCHAR(16),
    "skipped_step_codes" VARCHAR(16)[] DEFAULT ARRAY[]::VARCHAR(16)[],

    CONSTRAINT "step_chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_snapshot" (
    "id" SERIAL NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_cids" VARCHAR(16)[] DEFAULT ARRAY[]::VARCHAR(16)[],
    "period_start" DATE,
    "period_end" DATE,
    "rank_limit" INTEGER,
    "response_range" VARCHAR(40),
    "range_matched" BOOLEAN,
    "status" VARCHAR(12) NOT NULL,
    "abort_reason" VARCHAR(20),
    "http_status" SMALLINT,

    CONSTRAINT "keyword_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword" (
    "id" SERIAL NOT NULL,
    "keyword_snapshot_id" INTEGER NOT NULL,
    "cid" VARCHAR(16),
    "rank" INTEGER NOT NULL,
    "keyword" VARCHAR(100) NOT NULL,
    "excluded_reason" VARCHAR(12),
    "selected_at" TIMESTAMPTZ(6),

    CONSTRAINT "keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rakuten_item" (
    "id" SERIAL NOT NULL,
    "item_code" VARCHAR(128) NOT NULL,
    "shop_code" VARCHAR(64) NOT NULL,
    "shop_name" VARCHAR(255),
    "item_name" TEXT NOT NULL,
    "item_url" VARCHAR(2048) NOT NULL,
    "model_code" VARCHAR(128),
    "model_code_norm" VARCHAR(128),
    "entry_source" VARCHAR(8) NOT NULL,
    "fetch_reason" VARCHAR(16) NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "genre_id" INTEGER,
    "genre_source" VARCHAR(16) NOT NULL,
    "genre_path" VARCHAR(500),
    "product_type" VARCHAR(64),
    "back_order_flag" BOOLEAN,
    "unlimited_inventory" BOOLEAN,
    "all_sku_same_price" BOOLEAN,
    "sale_starts_at" TIMESTAMPTZ(6),
    "sale_ends_at" TIMESTAMPTZ(6),
    "description_html" TEXT,
    "description_text" TEXT,
    "attributes" JSONB,
    "variant_selectors" JSONB,
    "image_urls" JSONB NOT NULL DEFAULT '[]',
    "manual_check_required" BOOLEAN NOT NULL DEFAULT false,
    "manual_check_note" VARCHAR(500),
    "raw_file_path" VARCHAR(1024),
    "raw_file_sha256" CHAR(64),
    "raw_file_bytes" INTEGER,

    CONSTRAINT "rakuten_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rakuten_sku" (
    "id" SERIAL NOT NULL,
    "rakuten_item_id" INTEGER NOT NULL,
    "variant_id" VARCHAR(64) NOT NULL,
    "color_label" VARCHAR(128),
    "color_code" VARCHAR(64),
    "size_label" VARCHAR(64),
    "size_mm" SMALLINT,
    "width_label" VARCHAR(64),
    "tax_included_price_yen" INTEGER,
    "quantity" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "back_order" BOOLEAN,
    "stock_condition" VARCHAR(32),
    "article_number" VARCHAR(32),
    "postage_included" BOOLEAN,
    "single_item_shipping" BOOLEAN,
    "selector_values" JSONB NOT NULL,
    "attributes" JSONB,

    CONSTRAINT "rakuten_sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_comparison" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "base_sourcing_comparison_id" INTEGER,
    "action" VARCHAR(16) NOT NULL,
    "search_keyword" VARCHAR(128),
    "source_url" VARCHAR(2048),
    "anchor_input_method" VARCHAR(16),
    "anchor_item_code" VARCHAR(128),
    "anchor_model_code" VARCHAR(128),
    "anchor_model_code_norm" VARCHAR(128),
    "anchor_color_code" VARCHAR(64),
    "anchor_color_label" VARCHAR(128),
    "comparison_performed" BOOLEAN NOT NULL DEFAULT true,
    "selected_rakuten_item_id" INTEGER,
    "shipping_yen" INTEGER,
    "shipping_source" VARCHAR(20),
    "detected_gender" VARCHAR(8),
    "gender_basis" VARCHAR(16),
    "owner_gender" VARCHAR(8),
    "child_size_suspect" BOOLEAN,
    "genre_scope" VARCHAR(16),
    "adult_product_confirmed_at" TIMESTAMPTZ(6),
    "params" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sourcing_comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_comparison_row" (
    "id" SERIAL NOT NULL,
    "sourcing_comparison_id" INTEGER NOT NULL,
    "row_source" VARCHAR(8) NOT NULL,
    "search_rank" SMALLINT,
    "item_code" VARCHAR(128) NOT NULL,
    "shop_code" VARCHAR(64) NOT NULL,
    "shop_name" VARCHAR(255),
    "item_name" TEXT NOT NULL,
    "item_url" VARCHAR(2048) NOT NULL,
    "api_item_price_yen" INTEGER,
    "api_item_price_min3_yen" INTEGER,
    "api_point_rate" SMALLINT,
    "api_postage_flag" SMALLINT,
    "review_count" INTEGER,
    "review_average" DECIMAL(3,2),
    "ship_overseas" BOOLEAN,
    "api_collected_at" TIMESTAMPTZ(6),
    "model_code_norm" VARCHAR(128),
    "color_code" VARCHAR(64),
    "anchor_match" VARCHAR(16),
    "jan_match" BOOLEAN,
    "maker_model_match" BOOLEAN,
    "ai_match" JSONB,
    "owner_match_decision" VARCHAR(16),
    "fetch_order" SMALLINT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "rakuten_item_id" INTEGER,
    "manual_check_required" BOOLEAN NOT NULL DEFAULT false,
    "manual_check_reason" VARCHAR(500),
    "in_stock_size_count" SMALLINT,
    "stock_pass" BOOLEAN,
    "representative_rakuten_sku_id" INTEGER,
    "representative_price_yen" INTEGER,
    "shipping_yen" INTEGER,
    "shipping_source" VARCHAR(20),
    "coupon_yen" INTEGER NOT NULL DEFAULT 0,
    "shop_event_multiplier" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "point_base_amount_yen" INTEGER,
    "points_base_pt" INTEGER,
    "points_item_pt" INTEGER,
    "points_shop_event_pt" INTEGER,
    "points_spu_pt" INTEGER,
    "points_total_pt" INTEGER,
    "effective_price_yen" INTEGER,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sourcing_comparison_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domestic_price" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "p_ref_krw" INTEGER NOT NULL,
    "source_kind" VARCHAR(16) NOT NULL,
    "source_label" VARCHAR(100),
    "source_url" VARCHAR(2048),
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domestic_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_coupon_input" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "coupon_yen" INTEGER NOT NULL,
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_coupon_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_judgement" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "sku_price_source" VARCHAR(16) NOT NULL,
    "rakuten_item_id" INTEGER,
    "rakuten_page_collected_at" TIMESTAMPTZ(6),
    "domestic_price_id" INTEGER NOT NULL,
    "coupon_yen" INTEGER NOT NULL DEFAULT 0,
    "shipping_yen" INTEGER NOT NULL,
    "shipping_estimated" BOOLEAN NOT NULL,
    "cost_fx_rate_id" INTEGER NOT NULL,
    "customs_jpy_fx_rate_id" INTEGER NOT NULL,
    "customs_usd_fx_rate_id" INTEGER NOT NULL,
    "forwarder_rate_table_id" INTEGER,
    "chargeable_weight_kg" DECIMAL(6,3),
    "c_ship_intl_krw" INTEGER,
    "c_fwd_krw" INTEGER NOT NULL,
    "fwd_coupon_krw" INTEGER NOT NULL DEFAULT 0,
    "fwd_assumed" BOOLEAN NOT NULL,
    "duty_free_limit_yen" INTEGER,
    "vat_mode" VARCHAR(1) NOT NULL,
    "pricing_rule" VARCHAR(20) NOT NULL,
    "target_margin_rate" DECIMAL(7,4) NOT NULL,
    "min_profit_krw" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "is_sale_candidate" BOOLEAN NOT NULL,
    "sellable_size_count" SMALLINT NOT NULL,
    "sale_price_krw" INTEGER,
    "exclusion_reason" VARCHAR(500),
    "judged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_judgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_judgement_size" (
    "id" SERIAL NOT NULL,
    "price_judgement_id" INTEGER NOT NULL,
    "size_mm" SMALLINT NOT NULL,
    "rakuten_sku_id" INTEGER,
    "sku_price_yen" INTEGER NOT NULL,
    "c_goods_krw" INTEGER NOT NULL,
    "v_usd" DECIMAL(10,2) NOT NULL,
    "is_duty_free" BOOLEAN NOT NULL,
    "two_pair_taxable" BOOLEAN NOT NULL,
    "is_boundary" BOOLEAN NOT NULL,
    "customs_value_krw" INTEGER,
    "c_tax_krw" INTEGER NOT NULL DEFAULT 0,
    "p_min_krw" INTEGER,
    "option_price_krw" INTEGER NOT NULL DEFAULT 0,
    "size_sale_price_krw" INTEGER,
    "c_mkt_krw" INTEGER,
    "vat_a_krw" INTEGER,
    "vat_b_krw" INTEGER,
    "profit_a_krw" INTEGER,
    "profit_b_krw" INTEGER,
    "margin_rate_a" DECIMAL(7,4),
    "points_reference_pt" INTEGER,
    "is_sellable" BOOLEAN NOT NULL,
    "unsellable_reason" VARCHAR(20),

    CONSTRAINT "price_judgement_size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rate" (
    "id" SERIAL NOT NULL,
    "rate_kind" VARCHAR(8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rate_value" DECIMAL(12,4) NOT NULL,
    "unit" SMALLINT NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "source_note" VARCHAR(200),
    "reference_at" TIMESTAMPTZ(6) NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_response" JSONB,

    CONSTRAINT "fx_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_decision" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "input_genre_id" INTEGER,
    "input_product_type" VARCHAR(64),
    "gender" VARCHAR(8) NOT NULL,
    "gender_changed_in_run" BOOLEAN NOT NULL DEFAULT false,
    "candidate_source" VARCHAR(20) NOT NULL,
    "category_options" JSONB NOT NULL,
    "leaf_category_id" VARCHAR(20),
    "whole_category_name" VARCHAR(500),
    "gender_path_match" BOOLEAN,
    "exceptional_categories" JSONB,
    "exception_decision" VARCHAR(16),
    "block_reason" VARCHAR(500),
    "kc_exempt_adult_confirmed_at" TIMESTAMPTZ(6),
    "certification_exclude_content" JSONB,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_asset" (
    "id" SERIAL NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "file_path" VARCHAR(1024) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "source_section" VARCHAR(20),
    "source_url" VARCHAR(2048),
    "source_item_code" VARCHAR(128),
    "source_shop_code" VARCHAR(64),
    "source_model_code_norm" VARCHAR(128),
    "source_color_code" VARCHAR(64),
    "collected_at" TIMESTAMPTZ(6),
    "usage_right" VARCHAR(16) NOT NULL DEFAULT 'REFERENCE_ONLY',
    "candidate_id" INTEGER,
    "derived_from_image_asset_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_run" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "slot_no" SMALLINT NOT NULL,
    "attempt_no" SMALLINT NOT NULL,
    "trigger_type" VARCHAR(16) NOT NULL,
    "prompt" TEXT NOT NULL,
    "prompt_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "face_option" VARCHAR(16) NOT NULL,
    "requested_size_px" INTEGER NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "provider_version" VARCHAR(40),
    "reference_set_sha256" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "refusal_reason" TEXT,
    "error_message" TEXT,
    "result_image_asset_id" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "generation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_reference" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "image_asset_id" INTEGER NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "no_person_confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thumbnail_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_reference_input" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "input_no" INTEGER NOT NULL,
    "image_asset_id" INTEGER NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "no_person_confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thumbnail_reference_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_selection" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "checklist" JSONB NOT NULL,
    "same_product_color_confirmed_at" TIMESTAMPTZ(6),
    "selected_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "thumbnail_selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_selection_image" (
    "id" SERIAL NOT NULL,
    "thumbnail_selection_id" INTEGER NOT NULL,
    "image_asset_id" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "thumbnail_selection_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_draft_copy" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "generated_copy" JSONB NOT NULL,
    "copy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_draft_copy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_draft_fact" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "source_item_code" VARCHAR(128),
    "source_page_url" VARCHAR(2048),
    "selected_color_raw" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_draft_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_draft_field" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "field_key" VARCHAR(48) NOT NULL,
    "value" JSONB,
    "generated_value" JSONB,
    "value_source" VARCHAR(16) NOT NULL,
    "extraction_method" VARCHAR(24),
    "evidence_quote" TEXT,
    "evidence_url" VARCHAR(2048),
    "evidence_image_asset_id" INTEGER,
    "basis_item_code" VARCHAR(128),
    "basis_sha256" CHAR(64),
    "owner_confirmed_at" TIMESTAMPTZ(6),
    "choice_pending" BOOLEAN NOT NULL DEFAULT false,
    "recheck_reason" VARCHAR(24),
    "recheck_resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_draft_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_draft_assembly" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "product_name" VARCHAR(255) NOT NULL,
    "notice_fields" JSONB NOT NULL,
    "notice_sizes_mm" SMALLINT[],
    "origin_area_code" VARCHAR(20) NOT NULL,
    "origin_area_plural" BOOLEAN NOT NULL DEFAULT false,
    "origin_area_content" VARCHAR(200),
    "importer" VARCHAR(100) NOT NULL,
    "spec_block_html" TEXT NOT NULL,
    "spec_origin_label" VARCHAR(200) NOT NULL,
    "disclosure_template_version" VARCHAR(40) NOT NULL,
    "disclosure_template_date" DATE NOT NULL,
    "disclosure_block_ids" VARCHAR(40)[],
    "disclosure_blocks" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "html_sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_draft_assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_set" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "recommend_keywords" VARCHAR(100)[] DEFAULT ARRAY[]::VARCHAR(100)[],
    "leaf_category_id" VARCHAR(20),
    "restricted_checked_at" TIMESTAMPTZ(6),
    "ai_relevance_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_set_competitor_input" (
    "id" SERIAL NOT NULL,
    "tag_set_id" INTEGER NOT NULL,
    "tag_competitor_input_id" INTEGER NOT NULL,

    CONSTRAINT "tag_set_competitor_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_candidate" (
    "id" SERIAL NOT NULL,
    "tag_set_id" INTEGER NOT NULL,
    "text" VARCHAR(100) NOT NULL,
    "text_key" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20),
    "in_recommend" BOOLEAN NOT NULL DEFAULT false,
    "in_competitor" BOOLEAN NOT NULL DEFAULT false,
    "owner_added" BOOLEAN NOT NULL DEFAULT false,
    "competitor_best_rank" INTEGER,
    "competitor_frequency" INTEGER,
    "input_order" INTEGER,
    "outcome" VARCHAR(16) NOT NULL,
    "filter_reason" VARCHAR(24),
    "filter_detail" VARCHAR(200),
    "restricted" BOOLEAN,
    "final_order" SMALLINT,

    CONSTRAINT "tag_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_owner_edit" (
    "id" SERIAL NOT NULL,
    "tag_set_id" INTEGER NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "text" VARCHAR(100) NOT NULL,
    "text_key" VARCHAR(100) NOT NULL,
    "edited_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tag_owner_edit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_competitor_input" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "source_type" VARCHAR(24) NOT NULL,
    "has_frequency" BOOLEAN NOT NULL,
    "item_count" INTEGER NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "tag_competitor_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_competitor_item" (
    "id" SERIAL NOT NULL,
    "tag_competitor_input_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "tag_text" VARCHAR(100) NOT NULL,
    "source_rank" INTEGER,
    "naver_product_id" VARCHAR(20),
    "frequency" INTEGER,

    CONSTRAINT "tag_competitor_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "price_judgement_id" INTEGER NOT NULL,
    "upload_result_id" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "item_code" VARCHAR(128) NOT NULL,
    "selected_color" VARCHAR(128) NOT NULL,
    "color_code" VARCHAR(64) NOT NULL,
    "seller_management_code" VARCHAR(200) NOT NULL,
    "display_status_type" VARCHAR(20) NOT NULL,
    "option_type" VARCHAR(20) NOT NULL DEFAULT 'COMBINATION',
    "request_json" JSONB NOT NULL,
    "validation_result" JSONB NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL,
    "request_sent_at" TIMESTAMPTZ(6),
    "response_received_at" TIMESTAMPTZ(6),
    "last_result_check_at" TIMESTAMPTZ(6),
    "registered_at" TIMESTAMPTZ(6),
    "origin_product_no" VARCHAR(20),
    "channel_product_no" VARCHAR(20),
    "http_status" SMALLINT,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "invalid_inputs" JSONB,
    "trace_id" VARCHAR(100),
    "idempotency_key" VARCHAR(64),
    "failed_at" TIMESTAMPTZ(6),
    "failure_kind" VARCHAR(30),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_switch" (
    "id" SERIAL NOT NULL,
    "singleton_key" SMALLINT NOT NULL DEFAULT 1,
    "api_blocked" BOOLEAN NOT NULL DEFAULT true,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_switch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_image" (
    "id" SERIAL NOT NULL,
    "source_sha256" CHAR(64) NOT NULL,
    "image_asset_id" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "trace_id" VARCHAR(100),
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_result" (
    "id" SERIAL NOT NULL,
    "step_run_id" INTEGER NOT NULL,
    "detail_content" TEXT NOT NULL,
    "detail_content_sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_result_image" (
    "id" SERIAL NOT NULL,
    "upload_result_id" INTEGER NOT NULL,
    "uploaded_image_id" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "upload_result_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_snapshot" (
    "id" SERIAL NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL,
    "app_version" VARCHAR(40) NOT NULL,
    "file_manifest" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "first_loaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_loaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forwarder_rate_table" (
    "id" SERIAL NOT NULL,
    "forwarder_name" VARCHAR(100),
    "source_file_name" VARCHAR(255) NOT NULL,
    "source_file_path" VARCHAR(1024),
    "source_file_sha256" CHAR(64) NOT NULL,
    "row_count" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "forwarder_rate_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forwarder_rate_tier" (
    "id" SERIAL NOT NULL,
    "forwarder_rate_table_id" INTEGER NOT NULL,
    "weight_max_kg" DECIMAL(6,3) NOT NULL,
    "fee" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "volumetric_divisor" INTEGER,
    "volumetric_applies_when" VARCHAR(200),

    CONSTRAINT "forwarder_rate_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_agency_profile" (
    "id" SERIAL NOT NULL,
    "singleton_key" SMALLINT NOT NULL DEFAULT 1,
    "overseas_shipping_commerce_addressbook_id" INTEGER,
    "return_commerce_addressbook_id" INTEGER,
    "dispatch_delivery_company_code" VARCHAR(40),
    "commerce_return_delivery_company_id" INTEGER,
    "delivery_fee_krw" INTEGER NOT NULL DEFAULT 0,
    "return_fee_krw" INTEGER,
    "exchange_fee_krw" INTEGER,
    "business_name" VARCHAR(100),
    "after_service_phone" VARCHAR(40),
    "after_service_guide" VARCHAR(1000),
    "importer" VARCHAR(100),
    "notice_fixed_texts" JSONB NOT NULL DEFAULT '{}',
    "max_purchase_quantity_per_order" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_agency_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rakuten_search_cache" (
    "id" SERIAL NOT NULL,
    "query_hash" CHAR(64) NOT NULL,
    "keyword" VARCHAR(128),
    "genre_id" INTEGER,
    "page" SMALLINT NOT NULL DEFAULT 1,
    "request_params" JSONB NOT NULL,
    "response_items" JSONB NOT NULL,
    "result_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rakuten_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rakuten_genre" (
    "id" SERIAL NOT NULL,
    "genre_id" INTEGER NOT NULL,
    "parent_genre_id" INTEGER,
    "genre_name" VARCHAR(255) NOT NULL,
    "genre_level" SMALLINT NOT NULL,
    "id_path" VARCHAR(255) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rakuten_genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_category" (
    "id" SERIAL NOT NULL,
    "category_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "whole_category_name" VARCHAR(500) NOT NULL,
    "exceptional_categories" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "detail_synced_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "commerce_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_origin_area" (
    "id" SERIAL NOT NULL,
    "origin_area_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_code" VARCHAR(20),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "commerce_origin_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_addressbook" (
    "id" SERIAL NOT NULL,
    "address_book_no" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address_type" VARCHAR(40),
    "is_overseas" BOOLEAN NOT NULL,
    "address_summary" VARCHAR(500),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "commerce_addressbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_return_delivery_company" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "commerce_return_delivery_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_meta_document" (
    "id" SERIAL NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "scope_key" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_meta_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_meta_sync_run" (
    "id" SERIAL NOT NULL,
    "target" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "item_count" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "commerce_meta_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_log" (
    "id" SERIAL NOT NULL,
    "called_at" TIMESTAMPTZ(6) NOT NULL,
    "kst_date" DATE NOT NULL,
    "target" VARCHAR(30) NOT NULL,
    "http_method" VARCHAR(10),
    "host" VARCHAR(255),
    "url_masked" VARCHAR(2048),
    "http_status" SMALLINT,
    "succeeded" BOOLEAN,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "item_count" INTEGER,
    "duration_ms" INTEGER,
    "trace_id" VARCHAR(100),
    "candidate_id" INTEGER,
    "step_run_id" INTEGER,

    CONSTRAINT "call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_action_log" (
    "id" SERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kst_date" DATE NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "candidate_id" INTEGER,
    "step_run_id" INTEGER,
    "registration_id" INTEGER,
    "step_code" VARCHAR(16),
    "gate" VARCHAR(2),
    "detail" JSONB,

    CONSTRAINT "user_action_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cli_check" (
    "id" SERIAL NOT NULL,
    "engine_code" VARCHAR(16) NOT NULL,
    "trigger" VARCHAR(16) NOT NULL,
    "installed" BOOLEAN NOT NULL,
    "bin_path" VARCHAR(1024),
    "cli_version" VARCHAR(40),
    "version_supported" BOOLEAN,
    "auth_status" VARCHAR(16) NOT NULL,
    "smoke_status" VARCHAR(16) NOT NULL,
    "model" VARCHAR(100),
    "latency_ms" INTEGER,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cli_check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_status_status_changed_at_idx" ON "candidate"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "candidate_status_history_candidate_id_changed_at_idx" ON "candidate_status_history"("candidate_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_step_candidate_id_step_code_key" ON "candidate_step"("candidate_id", "step_code");

-- CreateIndex
CREATE UNIQUE INDEX "step_run_candidate_id_step_code_version_key" ON "step_run"("candidate_id", "step_code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "step_run_id_candidate_id_step_code_key" ON "step_run"("id", "candidate_id", "step_code");

-- CreateIndex
CREATE UNIQUE INDEX "step_run_input_step_run_id_input_key_key" ON "step_run_input"("step_run_id", "input_key");

-- CreateIndex
CREATE INDEX "gate_pass_candidate_id_gate_passed_at_idx" ON "gate_pass"("candidate_id", "gate", "passed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "step_chain_id_candidate_id_key" ON "step_chain"("id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_keyword_snapshot_id_cid_rank_key" ON "keyword"("keyword_snapshot_id", "cid", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "rakuten_item_id_collected_at_key" ON "rakuten_item"("id", "collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "rakuten_sku_rakuten_item_id_variant_id_key" ON "rakuten_sku"("rakuten_item_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_comparison_step_run_id_key" ON "sourcing_comparison"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_comparison_row_sourcing_comparison_id_item_code_key" ON "sourcing_comparison_row"("sourcing_comparison_id", "item_code");

-- CreateIndex
CREATE INDEX "domestic_price_candidate_id_entered_at_idx" ON "domestic_price"("candidate_id", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "pricing_coupon_input_candidate_id_entered_at_idx" ON "pricing_coupon_input"("candidate_id", "entered_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "price_judgement_step_run_id_key" ON "price_judgement"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_judgement_size_price_judgement_id_size_mm_key" ON "price_judgement_size"("price_judgement_id", "size_mm");

-- CreateIndex
CREATE INDEX "fx_rate_rate_kind_currency_reference_at_idx" ON "fx_rate"("rate_kind", "currency", "reference_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "category_decision_step_run_id_key" ON "category_decision"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_run_result_image_asset_id_key" ON "generation_run"("result_image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_run_step_run_id_slot_no_attempt_no_key" ON "generation_run"("step_run_id", "slot_no", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_reference_step_run_id_image_asset_id_key" ON "thumbnail_reference"("step_run_id", "image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_reference_step_run_id_sort_order_key" ON "thumbnail_reference"("step_run_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_reference_input_candidate_id_input_no_sort_order_key" ON "thumbnail_reference_input"("candidate_id", "input_no", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_reference_input_candidate_id_input_no_image_asset_key" ON "thumbnail_reference_input"("candidate_id", "input_no", "image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_selection_step_run_id_key" ON "thumbnail_selection"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_selection_image_thumbnail_selection_id_sort_order_key" ON "thumbnail_selection_image"("thumbnail_selection_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_selection_image_thumbnail_selection_id_image_asse_key" ON "thumbnail_selection_image"("thumbnail_selection_id", "image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_draft_copy_step_run_id_key" ON "content_draft_copy"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_draft_fact_step_run_id_key" ON "content_draft_fact"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_draft_field_step_run_id_field_key_key" ON "content_draft_field"("step_run_id", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "content_draft_assembly_step_run_id_key" ON "content_draft_assembly"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_set_step_run_id_key" ON "tag_set"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_set_competitor_input_tag_set_id_tag_competitor_input_id_key" ON "tag_set_competitor_input"("tag_set_id", "tag_competitor_input_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_candidate_tag_set_id_text_key_key" ON "tag_candidate"("tag_set_id", "text_key");

-- CreateIndex
CREATE UNIQUE INDEX "tag_candidate_tag_set_id_final_order_key" ON "tag_candidate"("tag_set_id", "final_order");

-- CreateIndex
CREATE UNIQUE INDEX "tag_owner_edit_tag_set_id_text_key_key" ON "tag_owner_edit"("tag_set_id", "text_key");

-- CreateIndex
CREATE UNIQUE INDEX "tag_competitor_item_tag_competitor_input_id_seq_key" ON "tag_competitor_item"("tag_competitor_input_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "registration_step_run_id_key" ON "registration"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_idempotency_key_key" ON "registration"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "registration_switch_singleton_key_key" ON "registration_switch"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_image_source_sha256_key" ON "uploaded_image"("source_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_image_image_asset_id_key" ON "uploaded_image"("image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_image_url_key" ON "uploaded_image"("url");

-- CreateIndex
CREATE UNIQUE INDEX "upload_result_step_run_id_key" ON "upload_result"("step_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_result_image_upload_result_id_sort_order_key" ON "upload_result_image"("upload_result_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "upload_result_image_upload_result_id_uploaded_image_id_key" ON "upload_result_image"("upload_result_id", "uploaded_image_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_snapshot_content_sha256_key" ON "settings_snapshot"("content_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "forwarder_rate_table_source_file_sha256_key" ON "forwarder_rate_table"("source_file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "forwarder_rate_tier_forwarder_rate_table_id_weight_max_kg_key" ON "forwarder_rate_tier"("forwarder_rate_table_id", "weight_max_kg");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_agency_profile_singleton_key_key" ON "purchase_agency_profile"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "rakuten_search_cache_query_hash_key" ON "rakuten_search_cache"("query_hash");

-- CreateIndex
CREATE UNIQUE INDEX "rakuten_genre_genre_id_key" ON "rakuten_genre"("genre_id");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_category_category_id_key" ON "commerce_category"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_origin_area_origin_area_code_key" ON "commerce_origin_area"("origin_area_code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_addressbook_address_book_no_key" ON "commerce_addressbook"("address_book_no");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_return_delivery_company_code_key" ON "commerce_return_delivery_company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_meta_document_kind_scope_key_key" ON "commerce_meta_document"("kind", "scope_key");

-- CreateIndex
CREATE INDEX "call_log_kst_date_target_idx" ON "call_log"("kst_date", "target");

-- CreateIndex
CREATE INDEX "ai_cli_check_engine_code_checked_at_idx" ON "ai_cli_check"("engine_code", "checked_at" DESC);

-- AddForeignKey
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_source_keyword_id_fkey" FOREIGN KEY ("source_keyword_id") REFERENCES "keyword"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_status_history" ADD CONSTRAINT "candidate_status_history_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_status_history" ADD CONSTRAINT "candidate_status_history_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_status_history" ADD CONSTRAINT "candidate_status_history_gate_pass_id_fkey" FOREIGN KEY ("gate_pass_id") REFERENCES "gate_pass"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_status_history" ADD CONSTRAINT "candidate_status_history_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registration"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_step" ADD CONSTRAINT "candidate_step_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "candidate_step" ADD CONSTRAINT "candidate_step_current_step_run_id_candidate_id_step_code_fkey" FOREIGN KEY ("current_step_run_id", "candidate_id", "step_code") REFERENCES "step_run"("id", "candidate_id", "step_code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_base_step_run_id_candidate_id_step_code_fkey" FOREIGN KEY ("base_step_run_id", "candidate_id", "step_code") REFERENCES "step_run"("id", "candidate_id", "step_code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_step_chain_id_candidate_id_fkey" FOREIGN KEY ("step_chain_id", "candidate_id") REFERENCES "step_chain"("id", "candidate_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_settings_snapshot_id_fkey" FOREIGN KEY ("settings_snapshot_id") REFERENCES "settings_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run_input" ADD CONSTRAINT "step_run_input_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_run_input" ADD CONSTRAINT "step_run_input_source_step_run_id_fkey" FOREIGN KEY ("source_step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gate_pass" ADD CONSTRAINT "gate_pass_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gate_pass" ADD CONSTRAINT "gate_pass_basis_step_run_id_candidate_id_basis_step_code_fkey" FOREIGN KEY ("basis_step_run_id", "candidate_id", "basis_step_code") REFERENCES "step_run"("id", "candidate_id", "step_code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "step_chain" ADD CONSTRAINT "step_chain_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "keyword" ADD CONSTRAINT "keyword_keyword_snapshot_id_fkey" FOREIGN KEY ("keyword_snapshot_id") REFERENCES "keyword_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rakuten_sku" ADD CONSTRAINT "rakuten_sku_rakuten_item_id_fkey" FOREIGN KEY ("rakuten_item_id") REFERENCES "rakuten_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison" ADD CONSTRAINT "sourcing_comparison_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison" ADD CONSTRAINT "sourcing_comparison_selected_rakuten_item_id_fkey" FOREIGN KEY ("selected_rakuten_item_id") REFERENCES "rakuten_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison" ADD CONSTRAINT "sourcing_comparison_base_sourcing_comparison_id_fkey" FOREIGN KEY ("base_sourcing_comparison_id") REFERENCES "sourcing_comparison"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison_row" ADD CONSTRAINT "sourcing_comparison_row_sourcing_comparison_id_fkey" FOREIGN KEY ("sourcing_comparison_id") REFERENCES "sourcing_comparison"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison_row" ADD CONSTRAINT "sourcing_comparison_row_rakuten_item_id_fkey" FOREIGN KEY ("rakuten_item_id") REFERENCES "rakuten_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sourcing_comparison_row" ADD CONSTRAINT "sourcing_comparison_row_representative_rakuten_sku_id_fkey" FOREIGN KEY ("representative_rakuten_sku_id") REFERENCES "rakuten_sku"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "domestic_price" ADD CONSTRAINT "domestic_price_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_coupon_input" ADD CONSTRAINT "pricing_coupon_input_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_rakuten_item_id_rakuten_page_collected_at_fkey" FOREIGN KEY ("rakuten_item_id", "rakuten_page_collected_at") REFERENCES "rakuten_item"("id", "collected_at") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_domestic_price_id_fkey" FOREIGN KEY ("domestic_price_id") REFERENCES "domestic_price"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_cost_fx_rate_id_fkey" FOREIGN KEY ("cost_fx_rate_id") REFERENCES "fx_rate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_customs_jpy_fx_rate_id_fkey" FOREIGN KEY ("customs_jpy_fx_rate_id") REFERENCES "fx_rate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_customs_usd_fx_rate_id_fkey" FOREIGN KEY ("customs_usd_fx_rate_id") REFERENCES "fx_rate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement" ADD CONSTRAINT "price_judgement_forwarder_rate_table_id_fkey" FOREIGN KEY ("forwarder_rate_table_id") REFERENCES "forwarder_rate_table"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement_size" ADD CONSTRAINT "price_judgement_size_price_judgement_id_fkey" FOREIGN KEY ("price_judgement_id") REFERENCES "price_judgement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_judgement_size" ADD CONSTRAINT "price_judgement_size_rakuten_sku_id_fkey" FOREIGN KEY ("rakuten_sku_id") REFERENCES "rakuten_sku"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "category_decision" ADD CONSTRAINT "category_decision_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "image_asset" ADD CONSTRAINT "image_asset_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "image_asset" ADD CONSTRAINT "image_asset_derived_from_image_asset_id_fkey" FOREIGN KEY ("derived_from_image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_result_image_asset_id_fkey" FOREIGN KEY ("result_image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_reference" ADD CONSTRAINT "thumbnail_reference_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_reference" ADD CONSTRAINT "thumbnail_reference_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_reference_input" ADD CONSTRAINT "thumbnail_reference_input_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_reference_input" ADD CONSTRAINT "thumbnail_reference_input_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_selection" ADD CONSTRAINT "thumbnail_selection_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_selection_image" ADD CONSTRAINT "thumbnail_selection_image_thumbnail_selection_id_fkey" FOREIGN KEY ("thumbnail_selection_id") REFERENCES "thumbnail_selection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "thumbnail_selection_image" ADD CONSTRAINT "thumbnail_selection_image_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_draft_copy" ADD CONSTRAINT "content_draft_copy_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_draft_fact" ADD CONSTRAINT "content_draft_fact_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_draft_field" ADD CONSTRAINT "content_draft_field_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_draft_field" ADD CONSTRAINT "content_draft_field_evidence_image_asset_id_fkey" FOREIGN KEY ("evidence_image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_draft_assembly" ADD CONSTRAINT "content_draft_assembly_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_set" ADD CONSTRAINT "tag_set_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_set_competitor_input" ADD CONSTRAINT "tag_set_competitor_input_tag_set_id_fkey" FOREIGN KEY ("tag_set_id") REFERENCES "tag_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_set_competitor_input" ADD CONSTRAINT "tag_set_competitor_input_tag_competitor_input_id_fkey" FOREIGN KEY ("tag_competitor_input_id") REFERENCES "tag_competitor_input"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_candidate" ADD CONSTRAINT "tag_candidate_tag_set_id_fkey" FOREIGN KEY ("tag_set_id") REFERENCES "tag_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_owner_edit" ADD CONSTRAINT "tag_owner_edit_tag_set_id_fkey" FOREIGN KEY ("tag_set_id") REFERENCES "tag_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_competitor_input" ADD CONSTRAINT "tag_competitor_input_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tag_competitor_item" ADD CONSTRAINT "tag_competitor_item_tag_competitor_input_id_fkey" FOREIGN KEY ("tag_competitor_input_id") REFERENCES "tag_competitor_input"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_price_judgement_id_fkey" FOREIGN KEY ("price_judgement_id") REFERENCES "price_judgement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_upload_result_id_fkey" FOREIGN KEY ("upload_result_id") REFERENCES "upload_result"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "uploaded_image" ADD CONSTRAINT "uploaded_image_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "image_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "upload_result" ADD CONSTRAINT "upload_result_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "upload_result_image" ADD CONSTRAINT "upload_result_image_upload_result_id_fkey" FOREIGN KEY ("upload_result_id") REFERENCES "upload_result"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "upload_result_image" ADD CONSTRAINT "upload_result_image_uploaded_image_id_fkey" FOREIGN KEY ("uploaded_image_id") REFERENCES "uploaded_image"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forwarder_rate_tier" ADD CONSTRAINT "forwarder_rate_tier_forwarder_rate_table_id_fkey" FOREIGN KEY ("forwarder_rate_table_id") REFERENCES "forwarder_rate_table"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_agency_profile" ADD CONSTRAINT "purchase_agency_profile_overseas_shipping_commerce_address_fkey" FOREIGN KEY ("overseas_shipping_commerce_addressbook_id") REFERENCES "commerce_addressbook"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_agency_profile" ADD CONSTRAINT "purchase_agency_profile_return_commerce_addressbook_id_fkey" FOREIGN KEY ("return_commerce_addressbook_id") REFERENCES "commerce_addressbook"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_agency_profile" ADD CONSTRAINT "purchase_agency_profile_commerce_return_delivery_company_i_fkey" FOREIGN KEY ("commerce_return_delivery_company_id") REFERENCES "commerce_return_delivery_company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_action_log" ADD CONSTRAINT "user_action_log_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_action_log" ADD CONSTRAINT "user_action_log_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_run"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_action_log" ADD CONSTRAINT "user_action_log_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registration"("id") ON DELETE SET NULL ON UPDATE RESTRICT;


-- ===== 2. Prisma 밖 SQL: CHECK · 부분/식 인덱스 · 트리거 · 목록 열 NOT NULL =====
--- CHECK 제약과 부분·식 인덱스 ---
-- candidate
ALTER TABLE candidate
  ADD CONSTRAINT ck_candidate_creation_path CHECK (creation_path IN ('KEYWORD','SEARCH_QUERY','RAKUTEN_URL','DIRECT_INPUT')),
  ADD CONSTRAINT ck_candidate_status CHECK (status IN ('TEMP','WORKING','EXCLUDED','AWAITING_APPROVAL','VALIDATED','REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED')),
  ADD CONSTRAINT ck_candidate_excluded_reason CHECK (excluded_reason IN ('ANCHOR_NO_MATCH','INSUFFICIENT_STOCK','NOT_SALE_CANDIDATE','OWNER_EXCLUDED')),
  ADD CONSTRAINT ck_candidate_excluded_pair CHECK ((status = 'EXCLUDED') = (excluded_reason IS NOT NULL)),
  ADD CONSTRAINT ck_candidate_gender CHECK (gender IN ('MALE','FEMALE')),
  ADD CONSTRAINT ck_candidate_gender_source CHECK (gender_source IN ('STEP2','OWNER')),
  ADD CONSTRAINT ck_candidate_gender_pair CHECK ((gender IS NULL) = (gender_source IS NULL)),
  ADD CONSTRAINT ck_candidate_gender_recheck CHECK (NOT gender_recheck_required OR gender_source = 'OWNER'),
  ADD CONSTRAINT ck_candidate_temp CHECK (status <> 'TEMP' OR (creation_path = 'DIRECT_INPUT' AND item_code IS NULL AND anchor_color_code IS NULL)),
  ADD CONSTRAINT ck_candidate_item_color_pair CHECK ((item_code IS NULL) = (selected_color IS NULL)),
  ADD CONSTRAINT ck_candidate_anchor_one CHECK (num_nonnulls(anchor_model_code, anchor_item_code) <= 1),
  ADD CONSTRAINT ck_candidate_anchor_base CHECK (anchor_color_code IS NULL OR anchor_model_code IS NOT NULL OR anchor_item_code IS NOT NULL),
  -- 아래 두 CHECK는 색상 코드를 늘 얻는다는 가정이다. M0 S2 결과로 완화할 수 있다(04-1_ERD.md §7.3-1)
  ADD CONSTRAINT ck_candidate_anchor_fixed CHECK ((anchor_color_code IS NULL) = (anchor_fixed_at IS NULL)),
  ADD CONSTRAINT ck_candidate_ready CHECK (status IN ('TEMP','WORKING','EXCLUDED') OR (item_code IS NOT NULL AND anchor_color_code IS NOT NULL AND gender IS NOT NULL AND leaf_category_id IS NOT NULL)),
  ADD CONSTRAINT ck_candidate_category_pair CHECK ((leaf_category_id IS NULL) = (whole_category_name IS NULL)),
  ADD CONSTRAINT ck_candidate_url_path CHECK (creation_path <> 'RAKUTEN_URL' OR source_url IS NOT NULL),
  ADD CONSTRAINT ck_candidate_keyword_path CHECK (creation_path <> 'KEYWORD' OR source_keyword_id IS NOT NULL);
CREATE UNIQUE INDEX uq_candidate_active_item_color ON candidate (item_code, selected_color)
  WHERE item_code IS NOT NULL AND status NOT IN ('EXCLUDED','REGISTERED');
-- candidate_status_history
ALTER TABLE candidate_status_history
  ADD CONSTRAINT ck_csh_from_status CHECK (from_status IN ('TEMP','WORKING','EXCLUDED','AWAITING_APPROVAL','VALIDATED','REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED')),
  ADD CONSTRAINT ck_csh_to_status CHECK (to_status IN ('TEMP','WORKING','EXCLUDED','AWAITING_APPROVAL','VALIDATED','REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED')),
  ADD CONSTRAINT ck_csh_reason CHECK (reason IN ('CREATED','TEMP_LINKED','ANCHOR_NO_MATCH','INSUFFICIENT_STOCK','NOT_SALE_CANDIDATE','OWNER_EXCLUDED','REOPENED','READY_FOR_APPROVAL','STEP_NOT_CURRENT','GATE_FINGERPRINT_CHANGED','REFETCH_G2_UNCHANGED','G4_APPROVED_BLOCKED','BLOCK_SWITCH_OFF','G4_APPROVED','REGISTER_SUCCEEDED','REGISTER_4XX','REGISTER_UNKNOWN','APP_RESTART','RESTART_REVERTED','SELLER_CODE_FOUND','SELLER_CODE_NOT_FOUND')),
  ADD CONSTRAINT ck_csh_created CHECK ((from_status IS NULL) = (reason = 'CREATED'));
-- candidate_step
ALTER TABLE candidate_step
  ADD CONSTRAINT ck_candidate_step_code CHECK (step_code IN ('SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD','REGISTER')),
  ADD CONSTRAINT ck_candidate_step_status CHECK (status IN ('NOT_RUN','RUNNING','WAITING_INPUT','COMPLETED','FAILED','RERUN_REQUIRED')),
  ADD CONSTRAINT ck_candidate_step_pointer CHECK ((status = 'NOT_RUN') = (current_step_run_id IS NULL)),
  ADD CONSTRAINT ck_candidate_step_stale CHECK ((status = 'RERUN_REQUIRED') = (stale_since IS NOT NULL)),
  ADD CONSTRAINT ck_candidate_step_stale_inputs CHECK (status = 'RERUN_REQUIRED' OR cardinality(stale_inputs) = 0),
  ADD CONSTRAINT ck_candidate_step_last_version CHECK (last_version >= 0);
CREATE INDEX ix_candidate_step_attention ON candidate_step (status)
  WHERE status IN ('RUNNING','WAITING_INPUT','FAILED','RERUN_REQUIRED');
-- step_run
ALTER TABLE step_run
  ADD CONSTRAINT ck_step_run_code CHECK (step_code IN ('SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD','REGISTER')),
  ADD CONSTRAINT ck_step_run_mode CHECK (execution_mode IN ('STEP','CHAIN','BATCH','CLI','OWNER_EDIT')),
  ADD CONSTRAINT ck_step_run_status CHECK (status IN ('RUNNING','WAITING_INPUT','COMPLETED','FAILED','RERUN_REQUIRED')),
  ADD CONSTRAINT ck_step_run_owner_action CHECK (owner_action IN ('EDIT','KEEP_AS_IS','RESTORE_VERSION')),
  ADD CONSTRAINT ck_step_run_owner_edit CHECK ((execution_mode = 'OWNER_EDIT') = (owner_action IS NOT NULL)),
  ADD CONSTRAINT ck_step_run_owner_base CHECK (owner_action IS NULL OR base_step_run_id IS NOT NULL),
  ADD CONSTRAINT ck_step_run_keep_copy_only CHECK (owner_action IS DISTINCT FROM 'KEEP_AS_IS' OR step_code = 'COPY'),
  ADD CONSTRAINT ck_step_run_chain CHECK ((execution_mode = 'CHAIN') = (step_chain_id IS NOT NULL)),
  ADD CONSTRAINT ck_step_run_failure_kind CHECK (failure_kind IN ('EXTERNAL_API','AI','INPUT_VALIDATION','INTERRUPTED')),
  ADD CONSTRAINT ck_step_run_failure_pair CHECK ((status = 'FAILED') = (failure_kind IS NOT NULL)),
  ADD CONSTRAINT ck_step_run_open CHECK ((status IN ('RUNNING','WAITING_INPUT')) = (ended_at IS NULL)),
  ADD CONSTRAINT ck_step_run_waiting CHECK ((status = 'WAITING_INPUT') = (waiting_since IS NOT NULL)),
  ADD CONSTRAINT ck_step_run_rerun_reason CHECK (status <> 'RERUN_REQUIRED' OR cardinality(rerun_reason_inputs) > 0),
  ADD CONSTRAINT ck_step_run_cli CHECK (execution_mode <> 'CLI' OR step_code <> 'REGISTER'),
  ADD CONSTRAINT ck_step_run_version CHECK (version >= 1),
  ADD CONSTRAINT ck_step_run_wait CHECK (wait_seconds_total >= 0),
  ADD CONSTRAINT ck_step_run_time CHECK (ended_at IS NULL OR ended_at >= started_at),
  ADD CONSTRAINT ck_step_run_fp CHECK (input_fingerprint_start ~ '^[0-9a-f]{64}$' AND (input_fingerprint_end IS NULL OR input_fingerprint_end ~ '^[0-9a-f]{64}$')),
  ADD CONSTRAINT ck_step_run_ai_engine CHECK (ai_engine IN ('CLAUDE','AGY','CODEX')),
  ADD CONSTRAINT ck_step_run_ai_model CHECK ((ai_engine IS NULL) = (ai_model IS NULL)),
  ADD CONSTRAINT ck_step_run_ai_cli_version CHECK (ai_cli_version IS NULL OR ai_engine IS NOT NULL);
CREATE UNIQUE INDEX uq_step_run_one_open ON step_run (candidate_id, step_code) WHERE status IN ('RUNNING','WAITING_INPUT');
-- step_run_input
ALTER TABLE step_run_input
  ADD CONSTRAINT ck_step_run_input_source CHECK (source_type IN ('PREV_STEP','OWNER_INPUT','SETTINGS')),
  ADD CONSTRAINT ck_step_run_input_prev CHECK ((source_type = 'PREV_STEP') = (source_step_run_id IS NOT NULL)),
  ADD CONSTRAINT ck_step_run_input_hash CHECK (value_hash ~ '^[0-9a-f]{64}$');
-- gate_pass
ALTER TABLE gate_pass
  ADD CONSTRAINT ck_gate_pass_gate CHECK (gate IN ('G2','G3')),
  ADD CONSTRAINT ck_gate_pass_basis CHECK ((gate = 'G2' AND basis_step_code = 'PRICING') OR (gate = 'G3' AND basis_step_code = 'THUMBNAIL')),
  ADD CONSTRAINT ck_gate_pass_fp CHECK (fingerprint ~ '^[0-9a-f]{64}$');
-- step_chain
ALTER TABLE step_chain
  ADD CONSTRAINT ck_step_chain_kind CHECK (kind IN ('FROM_HERE','RERUN_STALE')),
  ADD CONSTRAINT ck_step_chain_start CHECK (kind <> 'FROM_HERE' OR start_step_code IS NOT NULL),
  ADD CONSTRAINT ck_step_chain_start_code CHECK (start_step_code IN ('SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD')),
  ADD CONSTRAINT ck_step_chain_stop_code CHECK (stop_step_code IN ('SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD','REGISTER')),
  ADD CONSTRAINT ck_step_chain_stop_reason CHECK (stop_reason IN ('AWAIT_G2','AWAIT_G3','AWAIT_G4','NO_RUNNABLE_STEP','APP_RESTART')),
  ADD CONSTRAINT ck_step_chain_end CHECK ((ended_at IS NULL) = (stop_reason IS NULL));
CREATE INDEX ix_step_chain_open ON step_chain (candidate_id) WHERE ended_at IS NULL;
-- keyword_snapshot (v0.5 P2-01: abort_reason 값 3개 NETWORK_ERROR·APP_RESTART·INTERRUPTED — V2 마이그레이션 04-6)
ALTER TABLE keyword_snapshot
  ADD CONSTRAINT ck_kws_method CHECK (method IN ('BUTTON','PASTE')),
  ADD CONSTRAINT ck_kws_status CHECK (status IN ('RUNNING','COMPLETED','ABORTED')),
  ADD CONSTRAINT ck_kws_abort_reason CHECK (abort_reason IN ('NO_RANKS_KEY','HTTP_404','NOT_JSON','RETURN_CODE','COUNT_MISMATCH','HTTP_403','HTTP_418','HTTP_429','NETWORK_ERROR','APP_RESTART','INTERRUPTED')),
  ADD CONSTRAINT ck_kws_abort_pair CHECK ((status = 'ABORTED') = (abort_reason IS NOT NULL)),
  ADD CONSTRAINT ck_kws_button CHECK (method = 'PASTE' OR (period_start IS NOT NULL AND period_end IS NOT NULL AND rank_limit IS NOT NULL)),
  ADD CONSTRAINT ck_kws_rank_limit CHECK (rank_limit IN (100, 500)),
  ADD CONSTRAINT ck_kws_period CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  ADD CONSTRAINT ck_kws_http CHECK (http_status IS NULL OR status = 'ABORTED');
-- keyword
ALTER TABLE keyword
  ADD CONSTRAINT ck_keyword_rank CHECK (rank >= 1),
  ADD CONSTRAINT ck_keyword_excluded CHECK (excluded_reason IN ('CHILD')),
  ADD CONSTRAINT ck_keyword_excluded_not_selected CHECK (excluded_reason IS NULL OR selected_at IS NULL);
-- rakuten_item
ALTER TABLE rakuten_item
  ADD CONSTRAINT ck_rakuten_item_entry CHECK (entry_source IN ('API','MANUAL')),
  ADD CONSTRAINT ck_rakuten_item_fetch CHECK (fetch_reason IN ('SOURCING','URL_ENTRY','STOCK_CHECK','REFETCH','SYNC')),
  ADD CONSTRAINT ck_rakuten_item_genre_source CHECK (genre_source IN ('API','PAGE_JSON','ITEM_SEARCH','NOT_FOUND')),
  ADD CONSTRAINT ck_rakuten_item_genre_pair CHECK ((genre_source = 'NOT_FOUND') = (genre_id IS NULL)),
  ADD CONSTRAINT ck_rakuten_item_raw_pair CHECK ((raw_file_path IS NULL) = (raw_file_sha256 IS NULL)),
  ADD CONSTRAINT ck_rakuten_item_raw CHECK (raw_file_sha256 IS NULL OR (raw_file_sha256 ~ '^[0-9a-f]{64}$' AND raw_file_bytes >= 0));
-- rakuten_sku
ALTER TABLE rakuten_sku
  ADD CONSTRAINT ck_rakuten_sku_price CHECK (tax_included_price_yen IS NULL OR tax_included_price_yen >= 0),
  ADD CONSTRAINT ck_rakuten_sku_size CHECK (size_mm IS NULL OR size_mm > 0);
-- sourcing_comparison
ALTER TABLE sourcing_comparison
  ADD CONSTRAINT ck_sc_action CHECK (action IN ('SEARCH_COMPARE','URL_CREATE','REFETCH')),
  ADD CONSTRAINT ck_sc_anchor_method CHECK (anchor_input_method IN ('SEARCH_PICK','CODE_ENTRY','URL_ITEM')),
  ADD CONSTRAINT ck_sc_detected_gender CHECK (detected_gender IN ('MALE','FEMALE')),
  ADD CONSTRAINT ck_sc_owner_gender CHECK (owner_gender IN ('MALE','FEMALE')),
  ADD CONSTRAINT ck_sc_gender_basis CHECK (gender_basis IN ('KEYWORD_CID','GENRE_PATH','ITEM_NAME')),
  ADD CONSTRAINT ck_sc_gender_pair CHECK ((detected_gender IS NULL) = (gender_basis IS NULL)),
  ADD CONSTRAINT ck_sc_genre_scope CHECK (genre_scope IN ('IN_SCOPE','OUT_OF_SCOPE','NOT_FOUND')),
  ADD CONSTRAINT ck_sc_url_no_compare CHECK (action <> 'URL_CREATE' OR comparison_performed = false),
  ADD CONSTRAINT ck_sc_search_compare CHECK (action <> 'SEARCH_COMPARE' OR comparison_performed = true),
  ADD CONSTRAINT ck_sc_url_source CHECK (action <> 'URL_CREATE' OR source_url IS NOT NULL),
  ADD CONSTRAINT ck_sc_search_keyword CHECK (action <> 'SEARCH_COMPARE' OR search_keyword IS NOT NULL),
  ADD CONSTRAINT ck_sc_selection_uncompared CHECK (NOT comparison_performed OR (selected_rakuten_item_id IS NULL AND shipping_yen IS NULL AND shipping_source IS NULL)),
  ADD CONSTRAINT ck_sc_shipping_pair CHECK ((shipping_yen IS NULL) = (shipping_source IS NULL)),
  ADD CONSTRAINT ck_sc_shipping_selected CHECK (shipping_yen IS NULL OR selected_rakuten_item_id IS NOT NULL),
  ADD CONSTRAINT ck_sc_shipping_source CHECK (shipping_source IN ('FREE','DEFAULT_ESTIMATE','OWNER_INPUT')),
  ADD CONSTRAINT ck_sc_shipping_free CHECK (shipping_source IS DISTINCT FROM 'FREE' OR shipping_yen = 0),
  ADD CONSTRAINT ck_sc_shipping_default CHECK (shipping_source IS DISTINCT FROM 'DEFAULT_ESTIMATE' OR shipping_yen > 0);
-- sourcing_comparison_row
ALTER TABLE sourcing_comparison_row
  ADD CONSTRAINT ck_scr_row_source CHECK (row_source IN ('API','MANUAL')),
  ADD CONSTRAINT ck_scr_anchor_match CHECK (anchor_match IN ('MATCH','NEEDS_REVIEW','NO_MATCH')),
  ADD CONSTRAINT ck_scr_owner_match CHECK (owner_match_decision IN ('MATCH','NO_MATCH')),
  ADD CONSTRAINT ck_scr_shipping_source CHECK (shipping_source IN ('FREE','DEFAULT_ESTIMATE','OWNER_INPUT')),
  ADD CONSTRAINT ck_scr_shipping_free CHECK (shipping_source IS DISTINCT FROM 'FREE' OR shipping_yen = 0),
  ADD CONSTRAINT ck_scr_shipping_default CHECK (shipping_source IS DISTINCT FROM 'DEFAULT_ESTIMATE' OR shipping_yen > 0),
  ADD CONSTRAINT ck_scr_verified CHECK (NOT is_verified OR rakuten_item_id IS NOT NULL),
  ADD CONSTRAINT ck_scr_selected CHECK (NOT is_selected OR is_verified),
  ADD CONSTRAINT ck_scr_coupon CHECK (coupon_yen >= 0),
  ADD CONSTRAINT ck_scr_multiplier CHECK (shop_event_multiplier >= 0),
  ADD CONSTRAINT ck_scr_review CHECK (review_average IS NULL OR review_average BETWEEN 0 AND 5);
CREATE UNIQUE INDEX uq_scr_one_selected ON sourcing_comparison_row (sourcing_comparison_id) WHERE is_selected;
-- domestic_price
ALTER TABLE domestic_price
  ADD CONSTRAINT ck_domestic_price_positive CHECK (p_ref_krw > 0),
  ADD CONSTRAINT ck_domestic_price_source CHECK (source_kind IN ('MANUAL','SELLAFINDER'));
-- pricing_coupon_input
ALTER TABLE pricing_coupon_input
  ADD CONSTRAINT ck_pci_coupon CHECK (coupon_yen >= 0);
-- price_judgement
ALTER TABLE price_judgement
  ADD CONSTRAINT ck_pj_sku_source CHECK (sku_price_source IN ('STEP2','OWNER_INPUT')),
  ADD CONSTRAINT ck_pj_step2_page CHECK (sku_price_source <> 'STEP2' OR (rakuten_item_id IS NOT NULL AND rakuten_page_collected_at IS NOT NULL)),
  ADD CONSTRAINT ck_pj_vat_mode CHECK (vat_mode IN ('A','B','C')),
  ADD CONSTRAINT ck_pj_pricing_rule CHECK (pricing_rule IN ('REF_MINUS_1PCT','REF_MINUS_100','MAX_SKU_SINGLE','OPTION_PRICE')),
  ADD CONSTRAINT ck_pj_nonneg CHECK (coupon_yen >= 0 AND shipping_yen >= 0 AND c_fwd_krw >= 0 AND fwd_coupon_krw >= 0 AND sellable_size_count >= 0),
  ADD CONSTRAINT ck_pj_targets CHECK (target_margin_rate >= 0 AND target_margin_rate < 1 AND min_profit_krw >= 0),
  ADD CONSTRAINT ck_pj_fwd_assumed CHECK (fwd_assumed = (forwarder_rate_table_id IS NULL)),
  ADD CONSTRAINT ck_pj_sale_price CHECK (NOT is_sale_candidate OR sale_price_krw IS NOT NULL),
  ADD CONSTRAINT ck_pj_sale_sizes CHECK (NOT is_sale_candidate OR sellable_size_count >= 1),
  ADD CONSTRAINT ck_pj_exclusion CHECK (is_sale_candidate = (exclusion_reason IS NULL));
-- price_judgement_size
ALTER TABLE price_judgement_size
  ADD CONSTRAINT ck_pjs_sellable_pair CHECK (is_sellable = (unsellable_reason IS NULL)),
  ADD CONSTRAINT ck_pjs_reason CHECK (unsellable_reason IN ('TAXABLE','P_MIN_OVER_REF','MODE_B_NEGATIVE')),
  ADD CONSTRAINT ck_pjs_taxable_reason CHECK (unsellable_reason IS DISTINCT FROM 'TAXABLE' OR NOT is_duty_free),
  ADD CONSTRAINT ck_pjs_nonneg CHECK (option_price_krw >= 0 AND c_tax_krw >= 0 AND sku_price_yen >= 0 AND size_mm > 0),
  ADD CONSTRAINT ck_pjs_duty_free_tax CHECK (NOT is_duty_free OR c_tax_krw = 0),
  ADD CONSTRAINT ck_pjs_taxable_cv CHECK (is_duty_free OR customs_value_krw IS NOT NULL),
  ADD CONSTRAINT ck_pjs_sellable_price CHECK (NOT is_sellable OR size_sale_price_krw IS NOT NULL);
-- fx_rate
ALTER TABLE fx_rate
  ADD CONSTRAINT ck_fx_kind CHECK (rate_kind IN ('COST','CUSTOMS')),
  ADD CONSTRAINT ck_fx_currency CHECK (currency IN ('JPY','USD')),
  ADD CONSTRAINT ck_fx_unit CHECK (unit IN (1, 100) AND (currency = 'JPY' OR unit = 1)),
  ADD CONSTRAINT ck_fx_source CHECK (source IN ('KEXIM','CUSTOMS_SERVICE','MANUAL')),
  ADD CONSTRAINT ck_fx_source_kind CHECK ((source <> 'KEXIM' OR rate_kind = 'COST') AND (source <> 'CUSTOMS_SERVICE' OR rate_kind = 'CUSTOMS')),
  ADD CONSTRAINT ck_fx_positive CHECK (rate_value > 0),
  ADD CONSTRAINT ck_fx_no_secret CHECK (raw_response IS NULL OR NOT (raw_response ?| array['authkey','authKey','serviceKey','servicekey']));
CREATE UNIQUE INDEX uq_fx_rate_auto ON fx_rate (rate_kind, currency, source, reference_at) WHERE source <> 'MANUAL';
-- category_decision
ALTER TABLE category_decision
  ADD CONSTRAINT ck_cd_gender CHECK (gender IN ('MALE','FEMALE')),
  ADD CONSTRAINT ck_cd_source CHECK (candidate_source IN ('MAPPING','GENDER_PATH_ALL','SEARCH')),
  ADD CONSTRAINT ck_cd_exception CHECK (exception_decision IN ('PASS','KC_EXEMPT','BLOCKED')),
  ADD CONSTRAINT ck_cd_kc_exempt CHECK (exception_decision IS DISTINCT FROM 'KC_EXEMPT' OR (kc_exempt_adult_confirmed_at IS NOT NULL AND certification_exclude_content IS NOT NULL)),
  ADD CONSTRAINT ck_cd_blocked CHECK (exception_decision IS DISTINCT FROM 'BLOCKED' OR block_reason IS NOT NULL),
  ADD CONSTRAINT ck_cd_leaf_pair CHECK ((leaf_category_id IS NULL) = (whole_category_name IS NULL)),
  ADD CONSTRAINT ck_cd_decided CHECK (decided_at IS NULL OR leaf_category_id IS NOT NULL);
-- image_asset
ALTER TABLE image_asset
  ADD CONSTRAINT ck_image_asset_kind CHECK (kind IN ('ORIGINAL','REFERENCE','GENERATED','UPLOAD')),
  ADD CONSTRAINT ck_image_asset_right CHECK (usage_right IN ('REFERENCE_ONLY','PERMITTED')),
  ADD CONSTRAINT ck_image_asset_section CHECK (source_section IN ('PRODUCT_IMAGE','DESCRIPTION_IMAGE')),
  ADD CONSTRAINT ck_image_asset_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_image_asset_dims CHECK (width > 0 AND height > 0 AND byte_size > 0),
  ADD CONSTRAINT ck_image_asset_original CHECK (kind <> 'ORIGINAL' OR (source_url IS NOT NULL AND source_item_code IS NOT NULL AND collected_at IS NOT NULL AND source_section IS NOT NULL)),
  ADD CONSTRAINT ck_image_asset_section_original CHECK (kind = 'ORIGINAL' OR source_section IS NULL),
  ADD CONSTRAINT ck_image_asset_right_by_kind CHECK ((kind IN ('ORIGINAL','REFERENCE') AND usage_right = 'REFERENCE_ONLY') OR (kind IN ('GENERATED','UPLOAD') AND usage_right = 'PERMITTED')),
  ADD CONSTRAINT ck_image_asset_candidate CHECK ((kind = 'ORIGINAL') = (candidate_id IS NULL)),
  ADD CONSTRAINT ck_image_asset_upload CHECK (kind <> 'UPLOAD' OR (derived_from_image_asset_id IS NOT NULL AND mime_type = 'image/jpeg' AND width = 1000 AND height = 1000 AND byte_size < 10485760));
CREATE UNIQUE INDEX uq_image_asset_original ON image_asset (source_item_code, sha256) WHERE kind = 'ORIGINAL';
-- generation_run
ALTER TABLE generation_run
  ADD CONSTRAINT ck_gen_status CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','REFUSED')),
  ADD CONSTRAINT ck_gen_trigger CHECK (trigger_type IN ('INITIAL','OWNER_RETRY','AUTO_RETRY')),
  ADD CONSTRAINT ck_gen_face CHECK (face_option IN ('FULL_FACE','CHIN_CROP','HANDS_UPPER_BODY')),
  ADD CONSTRAINT ck_gen_provider CHECK (provider IN ('AGY','GEMINI_API','OPENAI_API','CODEX')),
  ADD CONSTRAINT ck_gen_numbers CHECK (slot_no >= 1 AND attempt_no >= 1 AND requested_size_px > 0),
  ADD CONSTRAINT ck_gen_refset CHECK (reference_set_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_gen_result CHECK ((status = 'SUCCEEDED') = (result_image_asset_id IS NOT NULL)),
  ADD CONSTRAINT ck_gen_refused CHECK (status <> 'REFUSED' OR refusal_reason IS NOT NULL),
  ADD CONSTRAINT ck_gen_finished CHECK ((status = 'RUNNING') = (finished_at IS NULL)),
  ADD CONSTRAINT ck_gen_time CHECK (finished_at IS NULL OR finished_at >= started_at);
-- thumbnail_reference
ALTER TABLE thumbnail_reference
  ADD CONSTRAINT ck_thumb_ref_order CHECK (sort_order BETWEEN 1 AND 3);
-- thumbnail_reference_input
ALTER TABLE thumbnail_reference_input
  ADD CONSTRAINT ck_thumb_ref_in_order CHECK (sort_order BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_thumb_ref_in_no CHECK (input_no >= 1);
-- thumbnail_selection
ALTER TABLE thumbnail_selection
  ADD CONSTRAINT ck_thumb_sel_checklist CHECK (jsonb_typeof(checklist) = 'object');
-- thumbnail_selection_image
ALTER TABLE thumbnail_selection_image
  ADD CONSTRAINT ck_thumb_sel_img_role CHECK (role IN ('REPRESENTATIVE','ADDITIONAL')),
  ADD CONSTRAINT ck_thumb_sel_img_order CHECK (sort_order BETWEEN 0 AND 9),
  ADD CONSTRAINT ck_thumb_sel_img_rep CHECK ((role = 'REPRESENTATIVE') = (sort_order = 0));
-- content_draft_copy
ALTER TABLE content_draft_copy
  ADD CONSTRAINT ck_cdc_json CHECK (jsonb_typeof(generated_copy) = 'object' AND jsonb_typeof(copy) = 'object');
-- content_draft_field
ALTER TABLE content_draft_field
  ADD CONSTRAINT ck_cdfield_key CHECK (field_key ~ '^(copy|fact|notice)\.[a-z_]+$' OR field_key = 'product_name'),
  ADD CONSTRAINT ck_cdfield_source CHECK (value_source IN ('GENERATED','OWNER_INPUT')),
  ADD CONSTRAINT ck_cdfield_method CHECK (extraction_method IN ('SKU_ATTRIBUTE','DESCRIPTION_PATTERN','AI','DICTIONARY','TEMPLATE','NONE')),
  ADD CONSTRAINT ck_cdfield_recheck_reason CHECK (recheck_reason IN ('ITEM_CODE_CHANGED','SALE_SIZES_CHANGED','NOTICE_RAW_CHANGED')),
  ADD CONSTRAINT ck_cdfield_recheck_target CHECK (recheck_reason IS NULL OR (value_source = 'OWNER_INPUT' AND field_key IN ('fact.origin','fact.material_upper','fact.material_lining','fact.material_sole','fact.heel_height','notice.size','notice.material','notice.origin_area'))),
  ADD CONSTRAINT ck_cdfield_resolved CHECK (recheck_resolved_at IS NULL OR recheck_reason IS NOT NULL),
  ADD CONSTRAINT ck_cdfield_owner_time CHECK (value_source <> 'OWNER_INPUT' OR owner_confirmed_at IS NOT NULL),
  ADD CONSTRAINT ck_cdfield_origin_url CHECK (field_key <> 'fact.origin' OR value_source <> 'OWNER_INPUT' OR evidence_url IS NOT NULL),
  ADD CONSTRAINT ck_cdfield_fact_method CHECK (field_key NOT LIKE 'fact.%' OR extraction_method IS NOT NULL OR value_source = 'OWNER_INPUT'),
  ADD CONSTRAINT ck_cdfield_basis CHECK (basis_sha256 IS NULL OR basis_sha256 ~ '^[0-9a-f]{64}$');
-- content_draft_assembly
ALTER TABLE content_draft_assembly
  ADD CONSTRAINT ck_cda_notice_json CHECK (jsonb_typeof(notice_fields) = 'object' AND jsonb_typeof(disclosure_blocks) = 'array'),
  ADD CONSTRAINT ck_cda_sizes CHECK (cardinality(notice_sizes_mm) > 0),
  ADD CONSTRAINT ck_cda_blocks CHECK (cardinality(disclosure_block_ids) > 0),
  ADD CONSTRAINT ck_cda_importer CHECK (char_length(importer) > 0),
  ADD CONSTRAINT ck_cda_html_sha CHECK (html_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_cda_origin_detail CHECK (origin_area_code !~ '^0[34]' OR origin_area_content IS NOT NULL);
-- tag_candidate
ALTER TABLE tag_candidate
  ADD CONSTRAINT ck_tag_cand_outcome CHECK (outcome IN ('SELECTED','NOT_SELECTED','FILTERED','RESTRICTED','OWNER_REMOVED','BELOW_SCORE')),
  ADD CONSTRAINT ck_tag_cand_filter_reason CHECK (filter_reason IN ('CATEGORY_TOKEN','BRAND_NAME','STORE_NAME','PROMOTION','ATTRIBUTE_MISMATCH')),
  ADD CONSTRAINT ck_tag_cand_filtered CHECK ((outcome = 'FILTERED') = (filter_reason IS NOT NULL)),
  ADD CONSTRAINT ck_tag_cand_restricted CHECK ((outcome = 'RESTRICTED') = COALESCE(restricted, false)),
  ADD CONSTRAINT ck_tag_cand_selected CHECK ((outcome = 'SELECTED') = (final_order IS NOT NULL)),
  ADD CONSTRAINT ck_tag_cand_order CHECK (final_order IS NULL OR final_order BETWEEN 1 AND 10),
  ADD CONSTRAINT ck_tag_cand_origin CHECK (in_recommend OR in_competitor OR owner_added),
  ADD CONSTRAINT ck_tag_cand_code CHECK (code IS NULL OR in_recommend),
  ADD CONSTRAINT ck_tag_cand_code_digits CHECK (code IS NULL OR code ~ '^[0-9]+$'),
  ADD CONSTRAINT ck_tag_cand_numbers CHECK ((competitor_best_rank IS NULL OR competitor_best_rank >= 1) AND (competitor_frequency IS NULL OR competitor_frequency >= 1));
-- tag_owner_edit
ALTER TABLE tag_owner_edit
  ADD CONSTRAINT ck_tag_edit_action CHECK (action IN ('ADD','REMOVE'));
-- tag_competitor_input
ALTER TABLE tag_competitor_input
  ADD CONSTRAINT ck_tag_ci_source CHECK (source_type IN ('SELLERFINDER','BROWSER_RESPONSE','FREE_TEXT')),
  ADD CONSTRAINT ck_tag_ci_count CHECK (item_count >= 0);
CREATE INDEX ix_tag_competitor_input_active ON tag_competitor_input (candidate_id) WHERE removed_at IS NULL;
-- tag_competitor_item
ALTER TABLE tag_competitor_item
  ADD CONSTRAINT ck_tag_citem_numbers CHECK (seq >= 1 AND (source_rank IS NULL OR source_rank >= 1) AND (frequency IS NULL OR frequency >= 1)),
  ADD CONSTRAINT ck_tag_citem_product_id CHECK (naver_product_id IS NULL OR naver_product_id ~ '^[0-9]+$');
-- registration
ALTER TABLE registration
  ADD CONSTRAINT ck_reg_status CHECK (status IN ('VALIDATED','REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED')),
  ADD CONSTRAINT ck_reg_display CHECK (display_status_type IN ('SUSPENSION','ON')),
  ADD CONSTRAINT ck_reg_option CHECK (option_type IN ('COMBINATION','STANDARD')),
  ADD CONSTRAINT ck_reg_seller_code CHECK (seller_management_code = 'RKT:' || item_code || ':' || color_code),
  ADD CONSTRAINT ck_reg_numbers CHECK ((origin_product_no IS NULL OR origin_product_no ~ '^[0-9]+$') AND (channel_product_no IS NULL OR channel_product_no ~ '^[0-9]+$')),
  ADD CONSTRAINT ck_reg_validated CHECK (status <> 'VALIDATED' OR (request_sent_at IS NULL AND origin_product_no IS NULL AND failed_at IS NULL)),
  ADD CONSTRAINT ck_reg_registered CHECK (status <> 'REGISTERED' OR (origin_product_no IS NOT NULL AND registered_at IS NOT NULL AND failed_at IS NULL)),
  ADD CONSTRAINT ck_reg_failure_pair CHECK ((failed_at IS NULL) = (failure_kind IS NULL)),
  ADD CONSTRAINT ck_reg_failure_kind CHECK (failure_kind IS NULL OR (failure_kind = 'INVALID_INPUT_4XX' AND status = 'REGISTERING') OR (failure_kind = 'NOT_FOUND_ON_CHECK' AND status = 'RESULT_CHECK_REQUIRED')),
  ADD CONSTRAINT ck_reg_4xx_status CHECK (failure_kind IS DISTINCT FROM 'INVALID_INPUT_4XX' OR http_status BETWEEN 400 AND 499);
CREATE UNIQUE INDEX uq_registration_live_key ON registration (item_code, selected_color)
  WHERE status IN ('REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED') AND failed_at IS NULL;
CREATE UNIQUE INDEX uq_registration_live_seller_code ON registration (seller_management_code)
  WHERE status IN ('REGISTERING','RESULT_CHECK_REQUIRED','REGISTERED') AND failed_at IS NULL;
-- registration_switch
ALTER TABLE registration_switch
  ADD CONSTRAINT ck_reg_switch_singleton CHECK (singleton_key = 1);
-- uploaded_image
ALTER TABLE uploaded_image
  ADD CONSTRAINT ck_uploaded_image_sha CHECK (source_sha256 ~ '^[0-9a-f]{64}$');
-- upload_result
ALTER TABLE upload_result
  ADD CONSTRAINT ck_upload_result_sha CHECK (detail_content_sha256 ~ '^[0-9a-f]{64}$');
-- upload_result_image
ALTER TABLE upload_result_image
  ADD CONSTRAINT ck_upload_img_role CHECK (role IN ('REPRESENTATIVE','ADDITIONAL')),
  ADD CONSTRAINT ck_upload_img_order CHECK (sort_order BETWEEN 0 AND 9),
  ADD CONSTRAINT ck_upload_img_rep CHECK ((role = 'REPRESENTATIVE') = (sort_order = 0));
-- settings_snapshot
ALTER TABLE settings_snapshot
  ADD CONSTRAINT ck_settings_snapshot_sha CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_settings_snapshot_time CHECK (last_loaded_at >= first_loaded_at);
-- forwarder_rate_table
ALTER TABLE forwarder_rate_table
  ADD CONSTRAINT ck_frt_rows CHECK (row_count > 0),
  ADD CONSTRAINT ck_frt_active CHECK (NOT is_active OR activated_at IS NOT NULL),
  ADD CONSTRAINT ck_frt_sha CHECK (source_file_sha256 ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX uq_forwarder_rate_table_one_active ON forwarder_rate_table ((true)) WHERE is_active;
-- forwarder_rate_tier
ALTER TABLE forwarder_rate_tier
  ADD CONSTRAINT ck_frtier_weight CHECK (weight_max_kg > 0),
  ADD CONSTRAINT ck_frtier_fee CHECK (fee >= 0),
  ADD CONSTRAINT ck_frtier_currency CHECK (currency IN ('JPY','KRW')),
  ADD CONSTRAINT ck_frtier_divisor CHECK (volumetric_divisor IS NULL OR volumetric_divisor > 0);
-- purchase_agency_profile
ALTER TABLE purchase_agency_profile
  ADD CONSTRAINT ck_pap_singleton CHECK (singleton_key = 1),
  ADD CONSTRAINT ck_pap_free_delivery CHECK (delivery_fee_krw = 0),
  ADD CONSTRAINT ck_pap_fees CHECK ((return_fee_krw IS NULL OR return_fee_krw >= 0) AND (exchange_fee_krw IS NULL OR exchange_fee_krw >= 0)),
  ADD CONSTRAINT ck_pap_qty CHECK (max_purchase_quantity_per_order >= 1);
-- rakuten_search_cache
ALTER TABLE rakuten_search_cache
  ADD CONSTRAINT ck_rsc_expiry CHECK (expires_at > fetched_at),
  ADD CONSTRAINT ck_rsc_numbers CHECK (page >= 1 AND result_count >= 0),
  ADD CONSTRAINT ck_rsc_hash CHECK (query_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_rsc_no_secret CHECK (NOT (request_params ?| array['applicationId','accessKey','applicationid','accesskey']));
-- rakuten_genre
ALTER TABLE rakuten_genre
  ADD CONSTRAINT ck_rakuten_genre_level CHECK (genre_level >= 1);
-- commerce_addressbook
ALTER TABLE commerce_addressbook
  ADD CONSTRAINT ck_addressbook_no CHECK (address_book_no ~ '^[0-9]+$');
-- commerce_meta_document
ALTER TABLE commerce_meta_document
  ADD CONSTRAINT ck_cmd_kind CHECK (kind IN ('CATEGORY_DETAIL','STANDARD_OPTIONS','PRODUCT_ATTRIBUTES','PROVIDED_NOTICE')),
  ADD CONSTRAINT ck_cmd_sha CHECK (payload_sha256 ~ '^[0-9a-f]{64}$');
-- commerce_meta_sync_run
ALTER TABLE commerce_meta_sync_run
  ADD CONSTRAINT ck_cmsr_target CHECK (target IN ('CATEGORY','CATEGORY_DETAIL','STANDARD_OPTIONS','PRODUCT_ATTRIBUTES','ORIGIN_AREA','ADDRESSBOOK','PROVIDED_NOTICE','RETURN_DELIVERY_COMPANY')),
  ADD CONSTRAINT ck_cmsr_status CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  ADD CONSTRAINT ck_cmsr_finished CHECK ((status = 'RUNNING') = (finished_at IS NULL)),
  ADD CONSTRAINT ck_cmsr_error CHECK (status <> 'FAILED' OR error_message IS NOT NULL);
-- call_log
ALTER TABLE call_log
  ADD CONSTRAINT ck_call_log_kst CHECK (kst_date = (called_at AT TIME ZONE 'Asia/Seoul')::date),
  ADD CONSTRAINT ck_call_log_target CHECK (target IN ('COMMERCE_API','RAKUTEN_API','RAKUTEN_PAGE','DATALAB','FX_KOREAEXIM','FX_CUSTOMS','NOTICE_MONITOR','UPDATE_CHECK','AI_CLAUDE_CLI','AI_AGY_CLI','AI_CODEX_CLI','AI_GEMINI_API','AI_OPENAI_API')),
  ADD CONSTRAINT ck_call_log_no_secret CHECK (url_masked IS NULL OR url_masked !~* '(accesskey|applicationid|client_secret|authkey|servicekey)=[^*&]'),
  ADD CONSTRAINT ck_call_log_numbers CHECK ((duration_ms IS NULL OR duration_ms >= 0) AND (item_count IS NULL OR item_count >= 0));
-- user_action_log
ALTER TABLE user_action_log
  ADD CONSTRAINT ck_ual_kst CHECK (kst_date = (occurred_at AT TIME ZONE 'Asia/Seoul')::date),
  ADD CONSTRAINT ck_ual_event CHECK (event_type IN ('GATE_PASSED','OWNER_CONFIRMED','OWNER_EDITED','CATEGORY_DECISION','SETTING_CHANGED','GATE_ENTERED','SCREEN_ENTERED','SCREEN_LEFT','WINDOW_INACTIVE','WINDOW_ACTIVE','PRODUCT_ACTION')),
  ADD CONSTRAINT ck_ual_gate CHECK (gate IN ('G1','G2','G3','G4','G5')),
  ADD CONSTRAINT ck_ual_gate_required CHECK (event_type NOT IN ('GATE_ENTERED','GATE_PASSED') OR gate IS NOT NULL),
  ADD CONSTRAINT ck_ual_step_code CHECK (step_code IN ('SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD','REGISTER'));
-- ai_cli_check
ALTER TABLE ai_cli_check
  ADD CONSTRAINT ck_ai_cli_check_engine CHECK (engine_code IN ('CLAUDE','AGY','CODEX')),
  ADD CONSTRAINT ck_ai_cli_check_trigger CHECK (trigger IN ('STARTUP','MANUAL','BEFORE_SAVE','FIRST_RUN')),
  ADD CONSTRAINT ck_ai_cli_check_auth CHECK (auth_status IN ('OK','NOT_LOGGED_IN','UNKNOWN')),
  ADD CONSTRAINT ck_ai_cli_check_smoke CHECK (smoke_status IN ('PASSED','FAILED','SKIPPED')),
  ADD CONSTRAINT ck_ai_cli_check_not_installed CHECK (installed OR smoke_status = 'SKIPPED'),
  ADD CONSTRAINT ck_ai_cli_check_skipped CHECK (smoke_status <> 'SKIPPED' OR (model IS NULL AND latency_ms IS NULL)),
  ADD CONSTRAINT ck_ai_cli_check_latency CHECK (latency_ms IS NULL OR latency_ms >= 0);

--- Prisma 목록 열 NOT NULL ---
-- Prisma는 목록(String[] 등)을 NULL 허용 열로 만든다. 앱은 NULL을 쓰지 않지만 NULL이 cardinality() CHECK를 통과하지 않도록 DB에서도 막는다.
-- prisma migrate diff는 목록 열의 NOT NULL을 되돌리지 않는다(로컬 PG 14.20에서 확인).
ALTER TABLE candidate_step ALTER COLUMN stale_inputs SET NOT NULL;
ALTER TABLE step_run ALTER COLUMN rerun_reason_inputs SET NOT NULL;
ALTER TABLE keyword_snapshot ALTER COLUMN requested_cids SET NOT NULL;
ALTER TABLE content_draft_assembly ALTER COLUMN notice_sizes_mm SET NOT NULL, ALTER COLUMN disclosure_block_ids SET NOT NULL;
ALTER TABLE tag_set ALTER COLUMN recommend_keywords SET NOT NULL;
ALTER TABLE commerce_category ALTER COLUMN exceptional_categories SET NOT NULL;
ALTER TABLE step_chain ALTER COLUMN skipped_step_codes SET NOT NULL,
  ADD CONSTRAINT ck_step_chain_skipped CHECK (skipped_step_codes <@ ARRAY['SOURCING','PRICING','CATEGORY','THUMBNAIL','COPY','NOTICE_RAW','NOTICE_HTML','TAGS','UPLOAD','REGISTER']::varchar[]);

--- 트리거 ---
-- candidate: candidate_anchor_fixed
CREATE OR REPLACE FUNCTION trg_candidate_anchor_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.anchor_fixed_at IS NOT NULL AND (
       NEW.anchor_model_code IS DISTINCT FROM OLD.anchor_model_code
    OR NEW.anchor_item_code  IS DISTINCT FROM OLD.anchor_item_code
    OR NEW.anchor_color_code IS DISTINCT FROM OLD.anchor_color_code
    OR NEW.anchor_fixed_at   IS DISTINCT FROM OLD.anchor_fixed_at) THEN
    RAISE EXCEPTION 'candidate %: anchor key is fixed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER candidate_anchor_fixed BEFORE UPDATE ON candidate
  FOR EACH ROW EXECUTE FUNCTION trg_candidate_anchor_fixed();
-- step_run: step_run_append_only
CREATE OR REPLACE FUNCTION trg_step_run_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'step_run is append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('RUNNING','WAITING_INPUT') THEN
    RAISE EXCEPTION 'step_run %: closed run cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.candidate_id <> OLD.candidate_id OR NEW.step_code <> OLD.step_code OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'step_run %: identity columns are immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ai_engine IS DISTINCT FROM OLD.ai_engine OR NEW.ai_model IS DISTINCT FROM OLD.ai_model
     OR NEW.ai_cli_version IS DISTINCT FROM OLD.ai_cli_version THEN
    RAISE EXCEPTION 'step_run %: AI engine columns are fixed at start', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER step_run_append_only BEFORE UPDATE OR DELETE ON step_run
  FOR EACH ROW EXECUTE FUNCTION trg_step_run_append_only();
-- 추가만 하는 이력: 수정·삭제 모두 거부
CREATE OR REPLACE FUNCTION trg_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: append-only table (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER candidate_status_history_append_only BEFORE UPDATE OR DELETE ON candidate_status_history FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER gate_pass_append_only BEFORE UPDATE OR DELETE ON gate_pass FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER rakuten_item_append_only BEFORE UPDATE OR DELETE ON rakuten_item FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER rakuten_sku_append_only BEFORE UPDATE OR DELETE ON rakuten_sku FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER domestic_price_append_only BEFORE UPDATE OR DELETE ON domestic_price FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER pricing_coupon_input_append_only BEFORE UPDATE OR DELETE ON pricing_coupon_input FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER fx_rate_append_only BEFORE UPDATE OR DELETE ON fx_rate FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER image_asset_append_only BEFORE UPDATE OR DELETE ON image_asset FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER thumbnail_reference_input_append_only BEFORE UPDATE OR DELETE ON thumbnail_reference_input FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER tag_competitor_item_append_only BEFORE UPDATE OR DELETE ON tag_competitor_item FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER uploaded_image_append_only BEFORE UPDATE OR DELETE ON uploaded_image FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER forwarder_rate_tier_append_only BEFORE UPDATE OR DELETE ON forwarder_rate_tier FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER user_action_log_append_only BEFORE UPDATE OR DELETE ON user_action_log FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER ai_cli_check_append_only BEFORE UPDATE OR DELETE ON ai_cli_check FOR EACH ROW EXECUTE FUNCTION trg_append_only();
-- 값은 갱신하지만 지우지 않는 표: 삭제만 거부
CREATE OR REPLACE FUNCTION trg_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER candidate_no_delete BEFORE DELETE ON candidate FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER candidate_step_no_delete BEFORE DELETE ON candidate_step FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER step_chain_no_delete BEFORE DELETE ON step_chain FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER keyword_snapshot_no_delete BEFORE DELETE ON keyword_snapshot FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER keyword_no_delete BEFORE DELETE ON keyword FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER generation_run_no_delete BEFORE DELETE ON generation_run FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER tag_competitor_input_no_delete BEFORE DELETE ON tag_competitor_input FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER registration_no_delete BEFORE DELETE ON registration FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER registration_switch_no_delete BEFORE DELETE ON registration_switch FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER settings_snapshot_no_delete BEFORE DELETE ON settings_snapshot FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER forwarder_rate_table_no_delete BEFORE DELETE ON forwarder_rate_table FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER purchase_agency_profile_no_delete BEFORE DELETE ON purchase_agency_profile FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER commerce_meta_sync_run_no_delete BEFORE DELETE ON commerce_meta_sync_run FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER call_log_no_delete BEFORE DELETE ON call_log FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
-- 단계 산출물: 그 StepRun이 열려 있을 때(실행중·입력대기)만 수정·삭제 허용
-- 인자 없음 = 행의 step_run_id를 본다. 인자 (부모 테이블, 부모 FK 열) = 부모 행의 step_run_id를 본다
CREATE OR REPLACE FUNCTION trg_output_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  run_id integer;
  run_status varchar(16);
BEGIN
  IF TG_NARGS = 0 THEN
    run_id := (to_jsonb(OLD) ->> 'step_run_id')::integer;
  ELSE
    EXECUTE format('SELECT step_run_id FROM %I WHERE id = $1', TG_ARGV[0])
      INTO run_id USING (to_jsonb(OLD) ->> TG_ARGV[1])::integer;
  END IF;
  SELECT status INTO run_status FROM step_run WHERE id = run_id;
  IF run_status IS NULL OR run_status NOT IN ('RUNNING','WAITING_INPUT') THEN
    RAISE EXCEPTION '%: output of closed step_run % cannot change', TG_TABLE_NAME, run_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER step_run_input_frozen BEFORE UPDATE OR DELETE ON step_run_input FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER sourcing_comparison_frozen BEFORE UPDATE OR DELETE ON sourcing_comparison FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER sourcing_comparison_row_frozen BEFORE UPDATE OR DELETE ON sourcing_comparison_row FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('sourcing_comparison', 'sourcing_comparison_id');
CREATE TRIGGER price_judgement_frozen BEFORE UPDATE OR DELETE ON price_judgement FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER price_judgement_size_frozen BEFORE UPDATE OR DELETE ON price_judgement_size FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('price_judgement', 'price_judgement_id');
CREATE TRIGGER category_decision_frozen BEFORE UPDATE OR DELETE ON category_decision FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER thumbnail_reference_frozen BEFORE UPDATE OR DELETE ON thumbnail_reference FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER thumbnail_selection_frozen BEFORE UPDATE OR DELETE ON thumbnail_selection FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER thumbnail_selection_image_frozen BEFORE UPDATE OR DELETE ON thumbnail_selection_image FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('thumbnail_selection', 'thumbnail_selection_id');
CREATE TRIGGER content_draft_copy_frozen BEFORE UPDATE OR DELETE ON content_draft_copy FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER content_draft_fact_frozen BEFORE UPDATE OR DELETE ON content_draft_fact FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER content_draft_field_frozen BEFORE UPDATE OR DELETE ON content_draft_field FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER content_draft_assembly_frozen BEFORE UPDATE OR DELETE ON content_draft_assembly FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER tag_set_frozen BEFORE UPDATE OR DELETE ON tag_set FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER tag_candidate_frozen BEFORE UPDATE OR DELETE ON tag_candidate FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('tag_set', 'tag_set_id');
CREATE TRIGGER tag_owner_edit_frozen BEFORE UPDATE OR DELETE ON tag_owner_edit FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('tag_set', 'tag_set_id');
CREATE TRIGGER tag_set_competitor_input_frozen BEFORE UPDATE OR DELETE ON tag_set_competitor_input FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('tag_set', 'tag_set_id');
CREATE TRIGGER upload_result_frozen BEFORE UPDATE OR DELETE ON upload_result FOR EACH ROW EXECUTE FUNCTION trg_output_frozen();
CREATE TRIGGER upload_result_image_frozen BEFORE UPDATE OR DELETE ON upload_result_image FOR EACH ROW EXECUTE FUNCTION trg_output_frozen('upload_result', 'upload_result_id');

