REVOKE EXECUTE ON FUNCTION public.bootstrap_swiza_company(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_swiza_company(text, text, text) TO authenticated;
