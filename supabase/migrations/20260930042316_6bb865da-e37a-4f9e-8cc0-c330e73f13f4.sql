INSERT INTO public.profiles (user_id, phone, full_name)
SELECT 'bf4f63a4-63ff-4c61-8e5f-3644bbcb3422', '254710100090', 'John Mungai'
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id='bf4f63a4-63ff-4c61-8e5f-3644bbcb3422');