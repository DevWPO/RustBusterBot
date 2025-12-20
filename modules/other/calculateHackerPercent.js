export function calculateHackerPercent(kd24, totalHours){
    let kd24h = Number(kd24) || 0;
    totalHours = Number(totalHours) || 0;

    if (kd24h <= 0) return 0;

    const kdFactor = Math.min(kd24h / 10, 1);
    const hoursFactor = 1 - Math.min(totalHours / 1000, 1);
    
    const percent = (kdFactor * 0.65 + hoursFactor * 0.35) * 100;

    return Math.round(percent);
}