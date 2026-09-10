import httpx

PREFIX = "/api/deployments"


async def edit(
    client: httpx.AsyncClient, url: str, revision: int = 1, /, **attributes: str | None
) -> httpx.Response:
    return await client.patch(
        url, headers={"If-Match": f'"{revision}"'}, json={"attributes": attributes}
    )
