REVOKE EXECUTE ON FUNCTION public.current_user_has_company(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_has_company_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_company_role(uuid, text[]) TO authenticated;
