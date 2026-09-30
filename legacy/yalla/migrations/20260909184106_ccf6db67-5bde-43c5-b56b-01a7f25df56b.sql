INSERT INTO public.company_collateral (slug, title, version, description, file_url, file_size, page_count, status, published_at)
VALUES (
  'company-profile',
  'Yalla Mobility — Enterprise Company Profile',
  'v1.0',
  'Six-page enterprise company profile for Yalla Mobility (Yalla Beena Limited): corporate identity, service ecosystem, corporate mobility, partners and future direction.',
  '/__l5e/assets-v1/356564ae-64df-4397-b5f8-4be38459796a/Yalla-Mobility-Company-Profile-6pp.pdf',
  913899,
  6,
  'published',
  now()
)
ON CONFLICT (slug, version) DO UPDATE
  SET file_url = EXCLUDED.file_url,
      file_size = EXCLUDED.file_size,
      page_count = EXCLUDED.page_count,
      description = EXCLUDED.description,
      status = 'published',
      published_at = now(),
      updated_at = now();