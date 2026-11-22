export function TripLoadError() {
  return (
    <section className="trip-load-error" aria-labelledby="trip-load-heading">
      <h1 id="trip-load-heading">여행을 불러오지 못했어요</h1>
      <p className="intro" role="alert">잠시 후 다시 시도해 주세요.</p>
      <form method="get">
        <button type="submit" className="primary-button">다시 불러오기</button>
      </form>
    </section>
  );
}
