import { bmFetch } from './bmFetch.js';
export async function getOrgServer(orgId, BMToken){
    let url = `https://api.battlemetrics.com/servers?filter[organizations]=${orgId}&filter[game]=rust&page[size]=100`;
    const servers = [];
    while (url){
        const data = await bmFetch(url,BMToken);
        servers.push(...(data.data) || []);
        url = data.links?.next || null;
    }
    return servers
}
