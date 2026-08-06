import { Store, getSettings } from "./db.js";
import { formatDuration } from "./timer.js";
import { nextMonthStr } from "./scheduling.js";

// "Les bons tuyaux de Huggy" — conseils calculés à partir des données déjà
// présentes dans l'appli (pas d'IA, juste des statistiques sur votre activité).
export async function computeTips() {
  const tips = [];
  const [devisList, visits, clients, tournees, waitlist, settings] = await Promise.all([
    Store.getAll("devis"),
    Store.getAll("visits"),
    Store.getAll("clients"),
    Store.getAll("tournees"),
    Store.getAll("waitlist"),
    getSettings(),
  ]);

  // 1. Devis en brouillon depuis longtemps
  const todayMs = Date.now();
  const staleDrafts = devisList.filter((d) => {
    if (d.status !== "brouillon") return false;
    const age = (todayMs - new Date(d.date).getTime()) / (1000 * 60 * 60 * 24);
    return age > 7;
  });
  if (staleDrafts.length > 0) {
    tips.push({
      icon: "📋",
      title: "Devis en attente de relance",
      text: `${staleDrafts.length} devis en brouillon depuis plus d'une semaine (ex: ${staleDrafts[0].clientName}). Une petite relance peut faire la différence.`,
    });
  }

  // 2. Un client prend nettement plus de temps que la moyenne
  if (visits.length >= 5) {
    const byClient = {};
    for (const v of visits) {
      if (!v.clientId) continue;
      (byClient[v.clientId] ||= []).push(v.durationSeconds);
    }
    const overallAvg = visits.reduce((s, v) => s + v.durationSeconds, 0) / visits.length;
    let worst = null;
    for (const [clientId, durations] of Object.entries(byClient)) {
      if (durations.length < 2) continue;
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (avg > overallAvg * 1.4 && (!worst || avg > worst.avg)) {
        const client = clients.find((c) => c.id === clientId);
        worst = { avg, name: client?.name || "un client" };
      }
    }
    if (worst) {
      tips.push({
        icon: "⏱️",
        title: "Un client prend plus de temps que la moyenne",
        text: `Chez ${worst.name}, vous passez en moyenne ${formatDuration(worst.avg).slice(0, 5)} contre ${formatDuration(overallAvg).slice(0, 5)} habituellement. Pensez à ajuster son tarif ou sa fréquence.`,
      });
    }
  }

  // 3. Kilométrage moyen par client sur les tournées enregistrées
  const totalKm = tournees.reduce((s, t) => s + (t.km || 0), 0);
  const totalClientsInTournees = tournees.reduce((s, t) => s + (t.clientIds?.length || 0), 0);
  if (totalClientsInTournees > 0) {
    const kmPerClient = totalKm / totalClientsInTournees;
    if (kmPerClient > 15) {
      tips.push({
        icon: "🗺️",
        title: "Vos tournées roulent beaucoup",
        text: `≈ ${Math.round(kmPerClient)} km par client en moyenne sur vos tournées enregistrées. Un nouveau calcul (option "Optimisée") pourrait réduire vos trajets.`,
      });
    }
  }

  // 4. Liste d'attente proche de la capacité du mois prochain
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const target = nextMonthStr(currentMonthStr);
  const nextMonthCount = waitlist.filter((w) => w.targetMonth === target).length;
  const monthlyCapacity = settings.maxClientsPerDay * settings.workDays.length * 4;
  if (nextMonthCount > 0 && nextMonthCount >= monthlyCapacity * 0.8) {
    tips.push({
      icon: "📈",
      title: "Votre liste d'attente se remplit",
      text: `${nextMonthCount} client(s) en attente pour le mois prochain, proche de votre capacité estimée (~${monthlyCapacity}/mois). C'est peut-être le moment d'augmenter vos prix ou de vous faire aider.`,
    });
  }

  // 5. Rendement horaire réel (devis acceptés ÷ temps chronométré)
  const acceptedDevis = devisList.filter((d) => d.status === "accepte");
  if (acceptedDevis.length > 0 && visits.length > 0) {
    const totalRevenue = acceptedDevis.reduce((s, d) => s + d.total, 0);
    const totalHours = visits.reduce((s, v) => s + v.durationSeconds, 0) / 3600;
    if (totalHours >= 1) {
      const revenuePerHour = totalRevenue / totalHours;
      const targetMin = Math.min(settings.rateHainautMin, settings.rateBruxellesMin);
      tips.push({
        icon: "💶",
        title: "Votre rendement horaire réel",
        text: revenuePerHour < targetMin
          ? `≈ ${Math.round(revenuePerHour)} €/h gagnés (devis acceptés ÷ temps chronométré), en dessous de votre taux plancher (${targetMin} €/h). Vérifiez vos temps de trajet et vos devis.`
          : `≈ ${Math.round(revenuePerHour)} €/h gagnés en moyenne (devis acceptés ÷ temps chronométré). Bon rythme, continuez ainsi !`,
      });
    }
  }

  if (tips.length === 0) {
    tips.push({
      icon: "🕵️",
      title: "Pas encore assez de données",
      text: "Continuez à utiliser le chrono, les devis et les tournées — Huggy aura bientôt de bons tuyaux pour vous.",
      notifiable: false,
    });
  }

  return tips;
}
