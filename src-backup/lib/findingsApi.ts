export const getFindings = async (repoId: string, token: string) => {
  const res = await fetch(`/api/repos/${repoId}/findings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
