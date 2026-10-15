/** A TV exit cannot wait indefinitely for storage; mobile retains its existing awaited save. */
export async function persistBeforePlayerExit(save: () => Promise<void>, nativeTv: boolean, timeoutMs=1500): Promise<void> {
  if(!nativeTv) {await save();return;}
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {await Promise.race([save(),new Promise<void>((resolve) => {timer=setTimeout(resolve,timeoutMs);})]);}
  finally {if(timer) clearTimeout(timer);}
}
