create table if not exists public.app_documents (
  collection text not null,
  id text not null,
  tenant_id text null,
  doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists app_documents_collection_idx
  on public.app_documents (collection);

create index if not exists app_documents_collection_tenant_idx
  on public.app_documents (collection, tenant_id);

create index if not exists app_documents_collection_updated_idx
  on public.app_documents (collection, updated_at desc);

create or replace function public.app_documents_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_documents_touch_updated_at on public.app_documents;

create trigger trg_app_documents_touch_updated_at
before update on public.app_documents
for each row
execute function public.app_documents_touch_updated_at();
