import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { createCanvas, loadImage } from "canvas";
import fs from "fs";

const TOKEN = process.env.GH_TOKEN;
const USER = process.env.TARGET_USER || "Gerson-if";

const theme = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  textMain: "#c9d1d9",
  textBold: "#f0f6fc",
  label: "#8b949e",
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
  const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    ranges.push({ start, end, label: monthNames[start.getMonth()] });
  }
  return ranges;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function main() {
  console.log("Buscando dados do GitHub...");

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
  const {
    totalCommitContributions,
    totalPullRequestContributions,
    totalIssueContributions,
  } = yearData.user.contributionsCollection;

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
          nodes {
            languages(first:10, orderBy:{field:SIZE, direction:DESC}) {
              edges { size node { name color } }
            }
          }
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
  const sortedLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const langLabels = sortedLangs.map(([name]) => name);
  const langValues = sortedLangs.map(
    ([, size]) => Math.round((size / totalBytes) * 1000) / 10
  );
  const langBg = sortedLangs.map(([name]) => langColors[name]);

  console.log("Renderizando gráficos...");

  const lineImgW = 668;
  const lineImgH = 300;
  const lineCanvas = new ChartJSNodeCanvas({
    width: lineImgW,
    height: lineImgH,
    backgroundColour: theme.card,
  });
  const lineBuffer = await lineCanvas.renderToBuffer({
    type: "line",
    data: {
      labels: monthly.map((m) => m.label),
      datasets: [
        {
          label: "Commits",
          data: monthly.map((m) => m.commits),
          borderColor: theme.green,
          backgroundColor: "rgba(46,160,67,0.12)",
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
        {
          label: "Pull Requests",
          data: monthly.map((m) => m.prs),
          borderColor: theme.purple,
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 3,
        },
        {
          label: "Issues",
          data: monthly.map((m) => m.issues),
          borderColor: theme.yellow,
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 3,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: theme.label, usePointStyle: true, font: { size: 11 } },
        },
      },
      scales: {
        x: { grid: { color: "#21262d" }, ticks: { color: theme.label } },
        y: {
          grid: { color: "#21262d" },
          ticks: { color: theme.label },
          beginAtZero: true,
        },
      },
    },
  });

  const donutImgW = 304;
  const donutImgH = 300;
  const donutCanvas = new ChartJSNodeCanvas({
    width: donutImgW,
    height: donutImgH,
    backgroundColour: theme.card,
  });
  const donutBuffer = await donutCanvas.renderToBuffer({
    type: "doughnut",
    data: {
      labels: langLabels,
      datasets: [
        {
          data: langValues,
          backgroundColor: langBg,
          borderWidth: 2,
          borderColor: theme.card,
        },
      ],
    },
    options: {
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: theme.label, boxWidth: 10, font: { size: 10 } },
        },
      },
    },
  });

  console.log("Compondo dashboard final...");

  const W = 1100;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = theme.textBold;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("📊 Visão Geral de Métricas do GitHub", 24, 38);

  const stats = [
    { label: "Repositórios", value: String(repoCount) },
    { label: "Commits (Ano Atual)", value: totalCommitContributions.toLocaleString("pt-BR") },
    { label: "Pull Requests", value: String(totalPullRequestContributions) },
    { label: "Issues", value: String(totalIssueContributions) },
  ];
  const cardW = (W - 24 * 2 - 16 * 3) / 4;
  const cardH = 78;
  const cardY = 58;
  stats.forEach((s, i) => {
    const x = 24 + i * (cardW + 16);
    roundRect(ctx, x, cardY, cardW, cardH, 8);
    ctx.fillStyle = theme.card;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    ctx.fillStyle = theme.label;
    ctx.font = "13px sans-serif";
    ctx.fillText(s.label, x + 14, cardY + 26);
    ctx.fillStyle = theme.textBold;
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(s.value, x + 14, cardY + 58);
  });

  const chartsY = cardY + cardH + 22;
  const lineCardW = lineImgW + 32;
  const lineCardH = lineImgH + 56;
  roundRect(ctx, 24, chartsY, lineCardW, lineCardH, 8);
  ctx.fillStyle = theme.card;
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  ctx.fillStyle = theme.textBold;
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("📈 Atividade nos Repositórios", 24 + 16, chartsY + 26);
  const lineImg = await loadImage(lineBuffer);
  ctx.drawImage(lineImg, 24 + 16, chartsY + 38, lineImgW, lineImgH);

  const donutX = 24 + lineCardW + 16;
  const donutCardW = donutImgW + 32;
  roundRect(ctx, donutX, chartsY, donutCardW, lineCardH, 8);
  ctx.fillStyle = theme.card;
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  ctx.fillStyle = theme.textBold;
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("💻 Linguagens", donutX + 16, chartsY + 26);
  const donutImg = await loadImage(donutBuffer);
  ctx.drawImage(donutImg, donutX + 16, chartsY + 38, donutImgW, donutImgH);

  fs.mkdirSync("generated", { recursive: true });
  fs.writeFileSync("generated/dashboard.png", canvas.toBuffer("image/png"));
  console.log("Dashboard gerada em generated/dashboard.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
