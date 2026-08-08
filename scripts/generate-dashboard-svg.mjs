import fs from "fs";

const TOKEN = process.env.GH_TOKEN;
const USER = process.env.TARGET_USER || "Gerson-if";

const theme = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  textBold: "#f0f6fc",
  label: "#8b949e",
  grid: "#21262d",
  green: "#2ea043",
  purple: "#a371f7",
  yellow: "#d29922",
};

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error(JSON.stringify(json.errors, null, 2));
    throw new Error("Erro na API GraphQL do GitHub");
  }
  return json.data;
}

function monthRanges(n) {
  const ranges = [];
  const now = new Date();
  const monthNames = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    ranges.push({ start, end, label: monthNames[start.getMonth()] });
  }
  return ranges;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fetchData() {
  const basic = await gql(
    `query($login:String!) {
      user(login:$login) {
        repositories(ownerAffiliations:[OWNER], isFork:false) { totalCount }
      }
    }`,
    { login: USER }
  );
  const repoCount = basic.user.repositories.totalCount;

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearEnd = now.toISOString();
  const yearData = await gql(
    `query($login:String!, $from:DateTime!, $to:DateTime!) {
      user(login:$login) {
        contributionsCollection(from:$from, to:$to) {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
        }
      }
    }`,
    { login: USER, from: yearStart, to: yearEnd }
  );
  const totals = yearData.user.contributionsCollection;

  const ranges = monthRanges(7);
  const monthly = [];
  for (const r of ranges) {
    const d = await gql(
      `query($login:String!, $from:DateTime!, $to:DateTime!) {
        user(login:$login) {
          contributionsCollection(from:$from, to:$to) {
            totalCommitContributions
            totalPullRequestContributions
            totalIssueContributions
          }
        }
      }`,
      { login: USER, from: r.start.toISOString(), to: r.end.toISOString() }
    );
    monthly.push({
      label: r.label,
      commits: d.user.contributionsCollection.totalCommitContributions,
      prs: d.user.contributionsCollection.totalPullRequestContributions,
      issues: d.user.contributionsCollection.totalIssueContributions,
    });
  }

  const langData = await gql(
    `query($login:String!) {
      user(login:$login) {
        repositories(first:100, ownerAffiliations:[OWNER], isFork:false) {
          nodes { languages(first:10, orderBy:{field:SIZE, direction:DESC}) { edges { size node { name color } } } }
        }
      }
    }`,
    { login: USER }
  );
  const langTotals = {};
  const langColors = {};
  for (const repo of langData.user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      langTotals[name] = (langTotals[name] || 0) + edge.size;
      langColors[name] = edge.node.color || "#8b949e";
    }
  }
  const totalBytes = Object.values(langTotals).reduce((a, b) => a + b, 0) || 1;
  const sortedLangs = Object.entries(langTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const languages = sortedLangs.map(([name, size]) => ({
    name,
    pct: Math.round((size / totalBytes) * 1000) / 10,
    color: langColors[name],
  }));

  return { repoCount, totals, monthly, languages };
}

function buildSVG({ repoCount, totals, monthly, languages }) {
  const W = 1100, H = 560;

  // ---- Stat cards ----
  const stats = [
    { label: "Repositórios", value: String(repoCount) },
    { label: "Commits (ano atual)", value: totals.totalCommitContributions.toLocaleString("pt-BR") },
    { label: "Pull Requests", value: String(totals.totalPullRequestContributions) },
    { label: "Issues", value: String(totals.totalIssueContributions) },
  ];
  const cardW = (W - 24 * 2 - 16 * 3) / 4;
  const cardH = 78, cardY = 58;

  let statCardsSVG = "";
  stats.forEach((s, i) => {
    const x = 24 + i * (cardW + 16);
    const delay = (i * 0.08).toFixed(2);
    statCardsSVG += `
    <g class="fade-up" style="animation-delay:${delay}s">
      <rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="8" fill="${theme.card}" stroke="${theme.border}"/>
      <text x="${x + 14}" y="${cardY + 26}" fill="${theme.label}" font-size="13" font-family="sans-serif">${esc(s.label)}</text>
      <text x="${x + 14}" y="${cardY + 58}" fill="${theme.textBold}" font-size="26" font-weight="700" font-family="sans-serif">${esc(s.value)}</text>
    </g>`;
  });

  // ---- Line chart ----
  const chartsY = cardY + cardH + 22;
  const lineCardW = 700, lineCardH = 336;
  const chartX0 = 24 + 50, chartX1 = 24 + lineCardW - 30;
  const chartY0 = chartsY + 46, chartY1 = chartY0 + 190;

  const maxRaw = Math.max(1, ...monthly.flatMap(m => [m.commits, m.prs, m.issues]));
  const maxVal = Math.ceil(maxRaw / 10) * 10 || 10;

  const xAt = i => chartX0 + (i * (chartX1 - chartX0)) / (monthly.length - 1);
  const yAt = v => chartY1 - (v / maxVal) * (chartY1 - chartY0);

  function seriesPath(key) {
    return monthly.map((m, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(m[key]).toFixed(1)}`).join(" ");
  }
  function pathLength(key) {
    let len = 0;
    for (let i = 1; i < monthly.length; i++) {
      const dx = xAt(i) - xAt(i - 1);
      const dy = yAt(monthly[i][key]) - yAt(monthly[i - 1][key]);
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.ceil(len) + 4;
  }

  const commitsPath = seriesPath("commits");
  const prsPath = seriesPath("prs");
  const issuesPath = seriesPath("issues");
  const areaPath = `${commitsPath} L${xAt(monthly.length - 1).toFixed(1)},${chartY1} L${xAt(0).toFixed(1)},${chartY1} Z`;

  let gridSVG = "";
  for (let g = 0; g <= 4; g++) {
    const val = Math.round((maxVal * g) / 4);
    const y = yAt(val);
    gridSVG += `
    <line x1="${chartX0}" y1="${y.toFixed(1)}" x2="${chartX1}" y2="${y.toFixed(1)}" stroke="${theme.grid}" stroke-width="1"/>
    <text x="${chartX0 - 10}" y="${(y + 4).toFixed(1)}" fill="${theme.label}" font-size="10" font-family="sans-serif" text-anchor="end">${val}</text>`;
  }

  let xLabelsSVG = "";
  let dotsSVG = "";
  monthly.forEach((m, i) => {
    const x = xAt(i);
    xLabelsSVG += `<text x="${x.toFixed(1)}" y="${chartY1 + 18}" fill="${theme.label}" font-size="10" font-family="sans-serif" text-anchor="middle">${esc(m.label)}</text>`;
    [["commits", theme.green], ["prs", theme.purple], ["issues", theme.yellow]].forEach(([key, color], di) => {
      dotsSVG += `<circle class="dot" style="animation-delay:${(1.5 + di * 0.05).toFixed(2)}s" cx="${x.toFixed(1)}" cy="${yAt(m[key]).toFixed(1)}" r="3" fill="${color}"/>`;
    });
  });

  const legendY = chartY1 + 42;
  const legendItems = [["Commits", theme.green], ["Pull Requests", theme.purple], ["Issues", theme.yellow]];
  let legendSVG = "";
  let lx = chartX0 + 30;
  legendItems.forEach(([label, color]) => {
    legendSVG += `
    <line x1="${lx}" y1="${legendY}" x2="${lx + 16}" y2="${legendY}" stroke="${color}" stroke-width="3"/>
    <text x="${lx + 22}" y="${legendY + 4}" fill="${theme.label}" font-size="11" font-family="sans-serif">${esc(label)}</text>`;
    lx += 22 + label.length * 6.5 + 26;
  });

  const lineChartSVG = `
  <g>
    <rect x="24" y="${chartsY}" width="${lineCardW}" height="${lineCardH}" rx="8" fill="${theme.card}" stroke="${theme.border}"/>
    <text x="${24 + 16}" y="${chartsY + 26}" fill="${theme.textBold}" font-size="15" font-weight="700" font-family="sans-serif">📈 Atividade nos Repositórios</text>
    ${gridSVG}
    <path d="${areaPath}" fill="${theme.green}" fill-opacity="0" class="area-fade"/>
    <path d="${commitsPath}" fill="none" stroke="${theme.green}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      style="stroke-dasharray:${pathLength("commits")};stroke-dashoffset:${pathLength("commits")};animation:draw 1.6s ease forwards;animation-delay:.3s"/>
    <path d="${prsPath}" fill="none" stroke="${theme.purple}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      style="stroke-dasharray:${pathLength("prs")};stroke-dashoffset:${pathLength("prs")};animation:draw 1.6s ease forwards;animation-delay:.5s"/>
    <path d="${issuesPath}" fill="none" stroke="${theme.yellow}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      style="stroke-dasharray:${pathLength("issues")};stroke-dashoffset:${pathLength("issues")};animation:draw 1.6s ease forwards;animation-delay:.7s"/>
    ${dotsSVG}
    ${xLabelsSVG}
    ${legendSVG}
  </g>`;

  // ---- Donut chart ----
  const donutX = 24 + lineCardW + 16, donutCardW = W - 24 - donutX;
  const cx = donutX + donutCardW / 2, cy = chartsY + 46 + 88;
  const r = 78, strokeW = 30;
  const circumference = 2 * Math.PI * r;

  let cumulative = 0;
  let donutSegsSVG = "";
  languages.forEach((l, i) => {
    const arcLen = (l.pct / 100) * circumference;
    const offset = -cumulative;
    const delay = (0.3 + i * 0.15).toFixed(2);
    donutSegsSVG += `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${l.color}" stroke-width="${strokeW}"
      stroke-dasharray="0 ${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt">
      <animate attributeName="stroke-dasharray" from="0 ${circumference.toFixed(1)}" to="${arcLen.toFixed(1)} ${(circumference - arcLen).toFixed(1)}"
        begin="${delay}s" dur="0.9s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
    </circle>`;
    cumulative += arcLen;
  });

  let legendRows = "";
  const legendStartY = cy + r + 34;
  languages.forEach((l, i) => {
    const y = legendStartY + i * 18;
    legendRows += `
    <g class="fade-up" style="animation-delay:${(0.9 + i * 0.06).toFixed(2)}s">
      <rect x="${donutX + 16}" y="${y - 9}" width="10" height="10" rx="2" fill="${l.color}"/>
      <text x="${donutX + 32}" y="${y}" fill="${theme.label}" font-size="11" font-family="sans-serif">${esc(l.name)}</text>
      <text x="${donutX + donutCardW - 16}" y="${y}" fill="${theme.label}" font-size="11" font-family="sans-serif" text-anchor="end">${l.pct}%</text>
    </g>`;
  });

  const donutChartSVG = `
  <g>
    <rect x="${donutX}" y="${chartsY}" width="${donutCardW}" height="${lineCardH}" rx="8" fill="${theme.card}" stroke="${theme.border}"/>
    <text x="${donutX + 16}" y="${chartsY + 26}" fill="${theme.textBold}" font-size="15" font-weight="700" font-family="sans-serif">💻 Linguagens</text>
    ${donutSegsSVG}
    ${legendRows}
  </g>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .fade-up { opacity: 0; animation: fadeUp .6s ease forwards; }
    @keyframes fadeUp { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform: translateY(0);} }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    .dot { opacity:0; animation: dotIn .3s ease forwards; }
    @keyframes dotIn { to { opacity:1; } }
    .area-fade { animation: areaIn 1.2s ease forwards; animation-delay: .9s; }
    @keyframes areaIn { to { fill-opacity: .12; } }
  </style>
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  <text x="24" y="38" fill="${theme.textBold}" font-size="22" font-weight="700" font-family="sans-serif">📊 Visão Geral de Métricas do GitHub</text>
  ${statCardsSVG}
  ${lineChartSVG}
  ${donutChartSVG}
</svg>`;
}

async function main() {
  console.log("Buscando dados do GitHub...");
  const data = await fetchData();
  console.log("Gerando SVG animado...");
  const svg = buildSVG(data);
  fs.mkdirSync("generated", { recursive: true });
  fs.writeFileSync("generated/dashboard.svg", svg);
  console.log("Dashboard gerada em generated/dashboard.svg");
}

main().catch(e => { console.error(e); process.exit(1); });
